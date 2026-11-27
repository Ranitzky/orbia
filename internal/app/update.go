package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"time"
)

const (
	updateInterval = 6 * time.Hour
	registry       = "https://ghcr.io"
	imageName      = "ranitzky/orbia"
	manifestTypes  = "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"
)

var buildRevision = regexp.MustCompile(`^[a-f0-9]{40}$`)
var manifestDigest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

// CheckForUpdates runs until ctx is canceled. Local builds have no published revision.
func (s *Server) CheckForUpdates(ctx context.Context, revision string) {
	if !buildRevision.MatchString(revision) {
		return
	}
	client := &http.Client{
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	s.checkForUpdates(ctx, client, revision)
}

func (s *Server) checkForUpdates(ctx context.Context, client *http.Client, revision string) {
	ticker := time.NewTicker(updateInterval)
	defer ticker.Stop()
	for {
		checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		available, err := registryUpdateAvailable(checkCtx, client, revision)
		cancel()
		if err == nil {
			s.updateAvailable.Store(available)
		} else if ctx.Err() == nil {
			slog.Warn("Could not check for an Orbia update", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// CI publishes each image under its commit SHA before updating the latest tag.
// Comparing the two manifest digests only requires metadata from the registry.
func registryUpdateAvailable(ctx context.Context, client *http.Client, revision string) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, registry+"/token?service=ghcr.io&scope=repository:"+imageName+":pull", nil)
	if err != nil {
		return false, err
	}
	response, err := client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("registry token request returned HTTP %d", response.StatusCode)
	}
	var credentials struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(&credentials); err != nil {
		return false, fmt.Errorf("decode registry token: %w", err)
	}
	if credentials.Token == "" {
		return false, errors.New("registry returned an empty token")
	}
	installed, err := registryManifestDigest(ctx, client, credentials.Token, revision)
	if err != nil {
		return false, err
	}
	latest, err := registryManifestDigest(ctx, client, credentials.Token, "latest")
	return err == nil && installed != latest, err
}

func registryManifestDigest(ctx context.Context, client *http.Client, token, tag string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, registry+"/v2/"+imageName+"/manifests/"+tag, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", manifestTypes)
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry manifest for %s returned HTTP %d", tag, response.StatusCode)
	}
	digest := response.Header.Get("Docker-Content-Digest")
	if !manifestDigest.MatchString(digest) {
		return "", fmt.Errorf("registry manifest for %s has an invalid digest", tag)
	}
	return digest, nil
}
