package app

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"slices"
	"testing"
)

func TestLANImportDialTargets(t *testing.T) {
	for _, tc := range []struct {
		name string
		ips  []string
		want []string
	}{
		{"private IPv4", []string{"10.0.0.1", "172.31.0.2", "192.168.1.4"}, []string{"10.0.0.1:9090", "172.31.0.2:9090", "192.168.1.4:9090"}},
		{"private IPv6", []string{"fd12::4", "::ffff:192.168.1.4"}, []string{"[fd12::4]:9090", "192.168.1.4:9090"}},
		{"mixed DNS answer", []string{"10.0.0.2", "93.184.216.34"}, nil},
		{"mapped public IPv4", []string{"::ffff:93.184.216.34"}, nil},
		{"link local", []string{"fe80::1"}, nil},
		{"unspecified", []string{"0.0.0.0"}, nil},
		{"empty", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var ips []netip.Addr
			for _, ip := range tc.ips {
				ips = append(ips, netip.MustParseAddr(ip))
			}
			var dialed []string
			_, err := dialLAN(context.Background(), "tcp", "9090", ips, func(_ context.Context, _, address string) (net.Conn, error) {
				dialed = append(dialed, address)
				return nil, errors.New("unavailable")
			})
			if !slices.Equal(dialed, tc.want) || errors.Is(err, errPublicHTTP) != (len(tc.want) == 0) {
				t.Fatalf("dialed %v, error %v", dialed, err)
			}
		})
	}
}

func TestLANImportIgnoresProxy(t *testing.T) {
	client := newLinkdingClient()
	transport := client.Transport.(linkdingTransport)
	if transport.lan.Proxy != nil {
		t.Fatal("HTTP import may send credentials to a proxy")
	}
}
