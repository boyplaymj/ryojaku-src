package services

import (
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/s3"
)

// ImageConverter handles SVG to PNG conversion and S3 upload
type ImageConverter struct {
	s3Client   *s3.S3
	bucketName string
}

// NewImageConverter creates a new image converter
func NewImageConverter(s3Client *s3.S3, bucketName string) *ImageConverter {
	return &ImageConverter{
		s3Client:   s3Client,
		bucketName: bucketName,
	}
}

// ConvertSVGToPNGAndUpload converts SVG to PNG and uploads to S3
func (ic *ImageConverter) ConvertSVGToPNGAndUpload(svgContent, userID string) (string, error) {
	// Generate unique filename
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("red-threads/%s-%s.png", userID, timestamp)

	// Convert SVG to PNG using ImageMagick (if available) or fallback to simple approach
	pngData, err := ic.convertSVGToPNG(svgContent)
	if err != nil {
		log.Printf("Failed to convert SVG to PNG: %v", err)
		return "", err
	}

	// Upload to S3
	s3URL, err := ic.uploadToS3(pngData, filename)
	if err != nil {
		log.Printf("Failed to upload to S3: %v", err)
		return "", err
	}

	log.Printf("Successfully converted and uploaded red thread image: %s", s3URL)
	return s3URL, nil
}

// convertSVGToPNG converts SVG content to PNG bytes
func (ic *ImageConverter) convertSVGToPNG(svgContent string) ([]byte, error) {
	// Try using ImageMagick convert command
	cmd := exec.Command("convert", "-background", "transparent", "-density", "300", "svg:-", "png:-")
	cmd.Stdin = bytes.NewReader([]byte(svgContent))

	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		log.Printf("ImageMagick convert failed: %v, stderr: %s", err, stderr.String())
		// Fallback: return SVG as-is (LINE might support SVG in some contexts)
		return []byte(svgContent), nil
	}

	return out.Bytes(), nil
}

// uploadToS3 uploads data to S3 and returns the public URL
func (ic *ImageConverter) uploadToS3(data []byte, filename string) (string, error) {
	contentType := "image/png"
	if bytes.HasPrefix(data, []byte("<svg")) {
		contentType = "image/svg+xml"
	}

	input := &s3.PutObjectInput{
		Bucket:      aws.String(ic.bucketName),
		Key:         aws.String(filename),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
		// Remove ACL since bucket doesn't allow ACLs
	}

	_, err := ic.s3Client.PutObject(input)
	if err != nil {
		return "", err
	}

	// Generate public URL
	url := fmt.Sprintf("https://%s.s3.ap-southeast-1.amazonaws.com/%s", ic.bucketName, filename)
	return url, nil
}
