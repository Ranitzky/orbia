package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

type bookmarkMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

var publicIPv6 = netip.MustParsePrefix("2000::/3")

var metadataBlockedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func publicBookmarkIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || (ip.Is6() && !publicIPv6.Contains(ip)) {
		return false
	}
	for _, prefix := range metadataBlockedNetworks {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func newBookmarkMetadataClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.MaxResponseHeaderBytes = 64 << 10
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		lastErr := errors.New("metadata lookup requires a public address")
		for _, ip := range ips {
			if !publicBookmarkIP(ip) {
				continue
			}
			// Dial the checked address directly to avoid a second DNS lookup.
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		return nil, lastErr
	}
	return &http.Client{
		Transport: transport,
		Timeout:   4 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 5 {
				return http.ErrUseLastResponse
			}
			req.Header.Del("Referer")
			_, err := validURL(req.URL.String())
			return err
		},
	}
}

func (s *Server) lookupBookmarkMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	var input struct {
		URL string `json:"url"`
	}
	if err := decode(w, r, &input, 32<<10); err != nil {
		writeError(w, 400, "Invalid metadata request.")
		return
	}
	url, err := validURL(input.URL)
	if err != nil {
		respondError(w, err)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	started := make(chan struct{}, 1)
	finished := make(chan *bookmarkMetadata, 1)
	trace := &httptrace.ClientTrace{WroteRequest: func(info httptrace.WroteRequestInfo) {
		if info.Err == nil {
			select {
			case started <- struct{}{}:
			default:
			}
		}
	}}
	go func() {
		metadata, err := fetchBookmarkMetadata(httptrace.WithClientTrace(ctx, trace), s.metadataClient, url)
		var dnsError *net.DNSError
		if errors.As(err, &dnsError) && dnsError.IsNotFound {
			finished <- nil
			return
		}
		finished <- &metadata
	}()

	select {
	case <-started:
		// Send the progress header only after the outbound HTTP request has been written.
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Orbia-Metadata-Fetching", "1")
		w.Header().Set("X-Accel-Buffering", "no")
		if err := http.NewResponseController(w).Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return
		}
		select {
		case metadata := <-finished:
			json.NewEncoder(w).Encode(metadata)
		case <-ctx.Done():
		}
	case metadata := <-finished:
		if metadata == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// A fast response can finish before the handler observes the write event.
		select {
		case <-started:
			w.Header().Set("X-Orbia-Metadata-Fetching", "1")
		default:
		}
		writeJSON(w, http.StatusOK, metadata)
	case <-ctx.Done():
	}
}

func fetchBookmarkMetadata(ctx context.Context, client *http.Client, url string) (bookmarkMetadata, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return bookmarkMetadata{}, err
	}
	req.Header.Set("Accept", "text/html, application/xhtml+xml")
	resp, err := client.Do(req)
	if err != nil {
		return bookmarkMetadata{}, err
	}
	defer resp.Body.Close()
	contentType := resp.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if resp.StatusCode != http.StatusOK || (mediaType != "text/html" && mediaType != "application/xhtml+xml") {
		return bookmarkMetadata{}, nil
	}
	reader, err := charset.NewReader(io.LimitReader(resp.Body, 512<<10), contentType)
	if err != nil {
		return bookmarkMetadata{}, err
	}
	return readBookmarkMetadata(reader), nil
}

func readBookmarkMetadata(r io.Reader) bookmarkMetadata {
	tokens := html.NewTokenizer(r)
	var title, description, ogTitle, ogDescription string
	for kind := tokens.Next(); kind != html.ErrorToken; kind = tokens.Next() {
		token := tokens.Token()
		if (kind == html.EndTagToken && token.Data == "head") || (kind == html.StartTagToken && token.Data == "body") {
			break
		}
		if kind != html.StartTagToken && kind != html.SelfClosingTagToken {
			continue
		}
		switch token.Data {
		case "title":
			if kind == html.StartTagToken && title == "" && tokens.Next() == html.TextToken {
				title = metadataText(string(tokens.Text()), 512)
			}
		case "meta":
			var name, property, content string
			for _, attr := range token.Attr {
				switch attr.Key {
				case "name":
					name = attr.Val
				case "property":
					property = attr.Val
				case "content":
					content = attr.Val
				}
			}
			switch {
			case ogTitle == "" && strings.EqualFold(property, "og:title"):
				ogTitle = metadataText(content, 512)
			case ogDescription == "" && strings.EqualFold(property, "og:description"):
				ogDescription = metadataText(content, 4096)
			case description == "" && strings.EqualFold(name, "description"):
				description = metadataText(content, 4096)
			}
		}
	}
	if ogTitle != "" {
		title = ogTitle
	}
	if ogDescription != "" {
		description = ogDescription
	}
	return bookmarkMetadata{Title: title, Description: description}
}

func metadataText(raw string, maxRunes int) string {
	runes := []rune(strings.Join(strings.Fields(raw), " "))
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	return string(runes)
}
