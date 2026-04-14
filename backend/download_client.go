package backend

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

func defaultDownloadHTTPClient() *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   downloadConnectTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   MaxConcurrentDownloads,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: downloadResponseHeaderWait,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   downloadRequestTimeout,
	}
}

func createDownloadHTTPClient(customProxy string) (*http.Client, error) {
	proxyURL, err := GetProxyURL(customProxy)
	if err != nil {
		return nil, err
	}

	client := defaultDownloadHTTPClient()
	if transport, ok := client.Transport.(*http.Transport); ok {
		transport.Proxy = http.ProxyURL(proxyURL)
	}

	return client, nil
}

type downloadHTTPStatusError struct {
	StatusCode int
	Status     string
}

func (e *downloadHTTPStatusError) Error() string {
	return fmt.Sprintf("bad status: %s", e.Status)
}

func shouldRetryDownload(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	var statusErr *downloadHTTPStatusError
	if errors.As(err, &statusErr) {
		return statusErr.StatusCode == http.StatusRequestTimeout ||
			statusErr.StatusCode == http.StatusTooManyRequests ||
			statusErr.StatusCode == http.StatusBadGateway ||
			statusErr.StatusCode == http.StatusServiceUnavailable ||
			statusErr.StatusCode == http.StatusGatewayTimeout
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}

	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "timeout") ||
		strings.Contains(lower, "connection reset") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "unexpected eof") ||
		strings.Contains(lower, "http2: stream closed")
}
