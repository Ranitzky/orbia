package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"time"
)

var errPublicHTTP = errors.New("HTTP imports require a private LAN or loopback address; use HTTPS for public destinations")

type linkdingTransport struct {
	lan *http.Transport
}

func (t linkdingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme == "http" {
		return t.lan.RoundTrip(r)
	}
	return http.DefaultTransport.RoundTrip(r)
}

func newLinkdingClient() *http.Client {
	lan := http.DefaultTransport.(*http.Transport).Clone()
	lan.Proxy = nil
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	lan.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		return dialLAN(ctx, network, port, ips, dialer.DialContext)
	}
	return &http.Client{
		Transport:     linkdingTransport{lan: lan},
		Timeout:       60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func dialLAN(ctx context.Context, network, port string, ips []netip.Addr,
	dial func(context.Context, string, string) (net.Conn, error)) (net.Conn, error) {
	// Check the entire DNS answer before opening a socket. Dial numeric addresses so
	// a second lookup cannot redirect the authenticated request to a public host.
	for _, ip := range ips {
		ip = ip.Unmap()
		if !ip.IsPrivate() && !ip.IsLoopback() {
			return nil, errPublicHTTP
		}
	}
	var lastErr error = errPublicHTTP
	for _, ip := range ips {
		conn, err := dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}
