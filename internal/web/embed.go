package web

import "embed"

// Files contains the entire browser application, including its local font.
//
//go:embed static
var Files embed.FS
