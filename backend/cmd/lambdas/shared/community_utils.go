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

// getS3BucketDomain 回傳要被正規化替換的 S3 直連網域。S2:讀 COMMUNITY_BUCKET
// env 組出我們的桶網域,不再寫死 prod 桶;env 未設則沿用預設 const。
func getS3BucketDomain() string {
	if b := os.Getenv("COMMUNITY_BUCKET"); b != "" {
		region := os.Getenv("AWS_REGION")
		if region == "" {
			region = "ap-southeast-1"
		}
		return b + ".s3." + region + ".amazonaws.com"
	}
	return S3BucketDomain
}

// NormalizeMediaURL replaces S3 direct URL with CloudFront CDN URL
func NormalizeMediaURL(url string) string {
	if url == "" {
		return ""
	}
	cdnDomain := GetCDNDomain()
	// Replace S3 bucket URL with CDN domain
	return strings.Replace(url, getS3BucketDomain(), cdnDomain, 1)
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
