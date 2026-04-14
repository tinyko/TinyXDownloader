package backend

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func getPartialDownloadPath(outputPath string) string {
	return outputPath + partialDownloadSuffix
}

func cleanupFile(path string) {
	if path == "" {
		return
	}
	_ = os.Remove(path)
}

func shouldSkipExistingFile(ctx context.Context, client *http.Client, mediaURL, outputPath, mediaType string) (bool, error) {
	_ = ctx
	_ = client
	_ = mediaURL

	info, err := os.Stat(outputPath)
	if err != nil {
		if os.IsNotExist(err) {
			cleanupFile(getPartialDownloadPath(outputPath))
			return false, nil
		}
		return false, err
	}

	if info.IsDir() {
		return false, fmt.Errorf("output path is a directory: %s", outputPath)
	}

	if mediaType == "text" {
		cleanupFile(getPartialDownloadPath(outputPath))
		return true, nil
	}

	localSize := info.Size()
	if localSize <= 0 {
		cleanupFile(outputPath)
		cleanupFile(getPartialDownloadPath(outputPath))
		return false, nil
	}

	cleanupFile(getPartialDownloadPath(outputPath))
	return true, nil
}

func getRemoteFileSize(ctx context.Context, client *http.Client, mediaURL string) (int64, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, mediaURL, nil)
	if err == nil {
		resp, err := client.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusOK && resp.ContentLength > 0 {
				return resp.ContentLength, true
			}
		}
	}

	req, err = http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return 0, false
	}
	req.Header.Set("Range", "bytes=0-0")

	resp, err := client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusPartialContent {
		contentRange := resp.Header.Get("Content-Range")
		if total := parseContentRangeTotal(contentRange); total > 0 {
			return total, true
		}
	}

	if resp.ContentLength > 0 {
		return resp.ContentLength, true
	}

	return 0, false
}

func parseContentRangeTotal(contentRange string) int64 {
	parts := strings.Split(contentRange, "/")
	if len(parts) != 2 {
		return 0
	}

	total, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || total <= 0 {
		return 0
	}

	return total
}

func downloadFileWithRetry(ctx context.Context, client *http.Client, url, outputPath string) error {
	var lastErr error

	for attempt := 1; attempt <= downloadRetryAttempts; attempt++ {
		lastErr = downloadFileWithContext(ctx, client, url, outputPath)
		if lastErr == nil {
			return nil
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		if !shouldRetryDownload(lastErr) || attempt == downloadRetryAttempts {
			return lastErr
		}

		time.Sleep(time.Duration(attempt) * time.Second)
	}

	return lastErr
}

func downloadFileWithContext(ctx context.Context, client *http.Client, url, outputPath string) (err error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &downloadHTTPStatusError{
			StatusCode: resp.StatusCode,
			Status:     resp.Status,
		}
	}

	tempPath := getPartialDownloadPath(outputPath)
	cleanupFile(tempPath)

	out, err := os.Create(tempPath)
	if err != nil {
		return err
	}
	defer func() {
		if out != nil {
			out.Close()
		}
		if err != nil || ctx.Err() != nil {
			cleanupFile(tempPath)
		}
	}()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	if closeErr := out.Close(); closeErr != nil {
		err = closeErr
		return err
	}
	out = nil

	if err := os.Rename(tempPath, outputPath); err != nil {
		cleanupFile(tempPath)
		return err
	}

	return nil
}

func downloadFile(client *http.Client, url, outputPath string) (err error) {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	tempPath := getPartialDownloadPath(outputPath)
	cleanupFile(tempPath)

	out, err := os.Create(tempPath)
	if err != nil {
		return err
	}
	defer func() {
		if out != nil {
			out.Close()
		}
		if err != nil {
			cleanupFile(tempPath)
		}
	}()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	if closeErr := out.Close(); closeErr != nil {
		err = closeErr
		return err
	}
	out = nil

	if err := os.Rename(tempPath, outputPath); err != nil {
		cleanupFile(tempPath)
		return err
	}

	return nil
}
