# FFmpeg Video Transcoder

A service for transcoding videos to HLS format using FFmpeg, with AWS S3 integration for storage.

## Features

- Convert videos to HLS format with adaptive bitrate streaming
- Generate video thumbnails
- Upload processed files to AWS S3
- Support for processing large HD videos (2+ hours)
- RESTful API for video processing

## Project Structure

The application uses a standard Node.js/TypeScript structure:

```
/
├── src/                  # Source code directory
│   ├── config/           # Configuration files
│   ├── controllers/      # API controllers
│   ├── services/         # Business logic services
│   ├── utils/            # Utility functions
│   ├── types/            # TypeScript type definitions
│   ├── consts/           # Constants
│   ├── routers/          # Express routers
│   └── index.ts          # Application entry point
├── uploads/              # Directory for temporary video storage
├── dist/                 # Compiled JavaScript (generated)
├── Dockerfile            # Docker configuration
├── docker-compose.yml    # Docker Compose configuration
└── package.json          # Node.js dependencies
```

## Docker Setup

### Prerequisites

- Docker and Docker Compose installed
- AWS S3 bucket or compatible storage service

### Environment Variables

Copy the example environment file and update with your settings:

```bash
cp .env.example .env
```

Edit the `.env` file with your AWS credentials and other configuration.

### Building and Running with Docker

Build and start the container:

```bash
docker-compose up -d
```

Stop the container:

```bash
docker-compose down
```

### Processing Large Videos

For processing large HD videos (2+ hours):

1. Ensure sufficient disk space is available on the host machine
2. The container is configured with 4GB memory limit by default
3. For very large videos, you may need to increase the memory limit in `docker-compose.yml`

## API Usage

### Convert Video to HLS

```
GET /objects?objectId=your-video-id&createThumbnail=true
```

This endpoint will:
1. Download the video from S3
2. Create a thumbnail (if requested)
3. Convert the video to HLS format
4. Upload the HLS files back to S3

### Check Health

```
GET /health
```

## Development

### Running Locally Without Docker

```bash
npm install
npm run build
npm start
```

### Building the Docker Image Manually

```bash
docker build -t video-transcoder .
docker run -p 3030:3030 --env-file .env video-transcoder
```

### Cleanup Script

A cleanup script is provided to help manage Docker resources:

```bash
chmod +x docker-cleanup.sh
./docker-cleanup.sh 