package shared

import (
	"os"
	"strings"
)

const (
	DefaultCDNDomain = "d31n6tynkarjq1.cloudfront.net"
	S3BucketDomain   = "mahjongclub-community-media.s3.ap-southeast-1.amazonaws.com"
)

// GetCDNDomain returns the CDN domain from environment variable or default
func GetCDNDomain() string {
	if domain := os.Getenv("CDN_DOMAIN"); domain != "" {
		return domain
	}
	return DefaultCDNDomain
}

// NormalizeMediaURL replaces S3 direct URL with CloudFront CDN URL
func NormalizeMediaURL(url string) string {
	if url == "" {
		return ""
	}
	cdnDomain := GetCDNDomain()
	// Replace S3 bucket URL with CDN domain
	return strings.Replace(url, S3BucketDomain, cdnDomain, 1)
}

// NormalizePostMediaURLs normalizes all image URLs in a post
func NormalizePostMediaURLs(post *Post) {
	if post == nil || len(post.Images) == 0 {
		return
	}
	for i, url := range post.Images {
		post.Images[i] = NormalizeMediaURL(url)
	}
}
