import ffmpeg from 'fluent-ffmpeg';
import * as path from "path";
import fs from 'fs';
import { logger } from '../utils';
import { s3 } from '../config';
import { resolutionTargets } from '../consts/video';
import { VariantPlaylist } from '../types';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const conversionStatus = new Map<string, string>();

/**
 * Create an HD thumbnail from a video file
 * @param videoPath - Path to the video file
 * @param objectId - Unique identifier for the video
 * @param options - Optional configuration parameters
 * @returns Path to the created thumbnail
 */
export const createThumbnail = async (
  videoPath: string,
  objectId: string,
  options: {
    outputDir?: string;
    timestamp?: string;
    size?: string;
    filename?: string;
  } = {}
): Promise<string> => {
  const {
    outputDir = path.join(UPLOADS_DIR, objectId), // Use the constant
    size = '1280x720', // HD resolution
    filename = `${objectId}_thumbnail.jpg`,
  } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const thumbnailPath = path.join(outputDir, filename);
  logger.info(`Creating HD thumbnail for video: ${videoPath}`);

  return new Promise<string>(async (resolve, reject) => {
    // Check if video file exists
    if (!fs.existsSync(videoPath)) {
      const error = new Error(`Video file not found: ${videoPath}`);
      logger.error(error.message);
      return reject(error);
    }

    try {
      // Get video duration to make sure we don't seek beyond the end
      const getDuration = (): Promise<number> => {
        return new Promise((resolve, reject) => {
          ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
              reject(new Error(`Failed to get video metadata: ${err.message}`));
            } else {
              resolve(metadata.format.duration || 0);
            }
          });
        });
      };

      const duration = await getDuration();
      // Choose a safe timestamp (default 10 seconds, but use 1 second for short videos)
      const timestamp = options.timestamp || (duration > 10 ? '00:00:10' : '00:00:01');

      logger.info(`Video duration: ${duration}s, using timestamp: ${timestamp}`);

      ffmpeg()
        .input(videoPath)
        .inputOptions([`-ss ${timestamp}`]) // Seek before input for better accuracy
        .output(thumbnailPath)
        .outputOptions([
          '-vframes 1',     // Extract a single frame
          `-s ${size}`,     // Resize to specified resolution
          '-q:v 2',         // High-quality JPEG (lower is better: 2 is best)
          '-threads 1'      // Use single thread for more stable processing
        ])
        .on('start', (commandLine) => {
          logger.info(`FFmpeg command: ${commandLine}`);
        })
        .on('end', () => {
          if (fs.existsSync(thumbnailPath)) {
            const stats = fs.statSync(thumbnailPath);
            logger.info(`Thumbnail created at: ${thumbnailPath} (${stats.size} bytes)`);
            resolve(thumbnailPath);
          } else {
            const error = new Error(`Thumbnail file was not created at: ${thumbnailPath}`);
            logger.error(error.message);
            reject(error);
          }
        })
        .on('error', (err) => {
          logger.error(`Thumbnail creation failed: ${err.message}`);
          reject(err);
        })
        .run();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to create thumbnail: ${errorMessage}`);
      reject(err);
    }
  });
};

export const getVideoResolution = (videoPath: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to get video metadata: ${err.message}`))
      } else {
        const videoStream = metadata.streams.find(
          (stream) => stream.codec_type === 'video'
        )
        if (videoStream) {
          resolve({
            width: videoStream.width as number,
            height: videoStream.height as number,
          })
        } else {
          reject(new Error('No video stream found in the file'))
        }
      }
    })
  })
}

// Add proper types to the function parameters
const calculateBitrate = (
  width: number,
  height: number,
  baseBitrate: number,
  complexityFactor: number = 1.0
): string => {
  const resolutionFactor = (width * height) / (1920 * 1080) // Normalize to 1080p
  const bitrate = Math.round(baseBitrate * resolutionFactor * complexityFactor)
  return `${bitrate}k`
}

// Generate resolutions dynamically without up-scaling
const getDynamicResolutions = (
  originalWidth: number,
  originalHeight: number,
  contentComplexity: number = 1.0
): Array<{
  width: number;
  height: number;
  bitrate: string;
  crf: number;
  name: string;
}> => {
  const resolutions = []
  const sourcePixels = originalWidth * originalHeight

  // Define possible target resolutions in descending order
  const possibleTargets = Object.entries(resolutionTargets).sort(
    ([, a], [, b]) => b.width * b.height - a.width * a.height
  )

  // Include resolutions up to and including the source resolution
  for (const [name, { width, height, baseBitrate, crf }] of possibleTargets) {
    const targetPixels = width * height
    if (targetPixels <= sourcePixels) {
      resolutions.push({
        width,
        height,
        bitrate: calculateBitrate(
          width,
          height,
          baseBitrate,
          contentComplexity
        ),
        crf,
        name,
      })
    }
  }

  // If no standard resolutions are below source, use the original resolution
  if (resolutions.length === 0) {
    const baseBitrate = resolutionTargets['720p'].baseBitrate // Use 720p as a reference for low-res
    resolutions.push({
      width: originalWidth,
      height: originalHeight,
      bitrate: calculateBitrate(
        originalWidth,
        originalHeight,
        baseBitrate,
        contentComplexity
      ),
      crf: 23, // Reasonable default for low-res
      name: `${originalHeight}p (source)`,
    })
  }

  return resolutions
}

export const generateSpriteSheet = async (videoPath: string, objectId: string): Promise<string> => {
  const outputDir = path.join(UPLOADS_DIR, objectId);
  const spriteSheetFilename = `${objectId}_spritesheet.jpg`;
  const spriteSheetPath = path.join(outputDir, spriteSheetFilename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  logger.info(`Generating sprite sheet for video: ${videoPath}`);

  try {
    // Check if video file exists
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // Extract video duration and check if the video is valid
    const getVideoInfo = async (): Promise<{ duration: number; fps: number }> => {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
          if (err) {
            reject(new Error(`Failed to get video metadata: ${err.message}`));
          } else {
            // Find video stream to get FPS
            const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
            let fps = 25; // Default assumption

            if (videoStream && videoStream.r_frame_rate) {
              // Parse frame rate (typically in format "30000/1001" for 29.97 fps)
              const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
              if (num && den) {
                fps = num / (den || 1);
              }
            }

            resolve({
              duration: metadata.format.duration || 0,
              fps
            });
          }
        });
      });
    };

    const { duration, fps } = await getVideoInfo();

    if (duration <= 0) {
      throw new Error(`Invalid video duration: ${duration}s`);
    }

    logger.info(`Video duration: ${duration}s, fps: ${fps}`);

    // Calculate number of thumbnails based on video duration
    // Use more frames for longer videos
    let rows = 5;
    let cols = 5;

    if (duration > 600) { // > 10 minutes
      rows = 8;
      cols = 10;
    } else if (duration > 300) { // > 5 minutes
      rows = 6;
      cols = 8;
    }

    const numThumbnails = rows * cols;
    logger.info(`Using ${rows}x${cols} grid (${numThumbnails} frames)`);

    // Create temporary directory for frames
    const framesDir = path.join(outputDir, 'frames_temp');
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // Improved thumbnail size (larger with better quality)
    const thumbWidth = 240;
    const thumbHeight = 135; // 16:9 aspect ratio

    // Distribute timestamps evenly across the video
    // Ensure we don't go beyond video duration and stay away from the very beginning/end
    const safeStart = Math.min(duration * 0.05, 2); // 5% of duration or 2 seconds, whichever is smaller
    const safeEnd = Math.max(duration * 0.95, duration - 2); // 95% of duration or 2 seconds before end
    const safeDuration = safeEnd - safeStart;

    if (safeDuration <= 0) {
      throw new Error(`Video is too short for sprite sheet generation: ${duration}s`);
    }

    const timestamps = Array.from({ length: numThumbnails }, (_, i) => {
      const position = safeStart + (safeDuration * i) / (numThumbnails - 1 || 1);
      return position.toFixed(2); // Two decimal places
    });

    // Use a more reliable approach for frame extraction
    // Extract frames one at a time with proper error handling
    const framePromises = timestamps.map((timestamp, index) => {
      return new Promise<string>((resolve, reject) => {
        const outputPath = path.join(framesDir, `frame-${index.toString().padStart(3, '0')}.jpg`);

        // Use more reliable seeking with input option
        ffmpeg()
          .input(videoPath)
          .inputOptions([`-ss ${timestamp}`, '-noaccurate_seek']) // Faster but less accurate seeking
          .outputOptions([
            `-vf scale=${thumbWidth}:${thumbHeight}`,
            '-frames:v 1',
            '-q:v 2'
          ])
          .output(outputPath)
          .on('end', () => {
            logger.info(`Extracted frame at ${timestamp}s`);
            resolve(outputPath);
          })
          .on('error', (err) => {
            // Don't fail the whole process if one frame fails
            logger.error(`Failed to extract frame at ${timestamp}s: ${err.message}`);
            // Create a blank frame as fallback
            createBlankFrame(outputPath, thumbWidth, thumbHeight)
              .then(() => resolve(outputPath))
              .catch((e) => reject(e));
          })
          .run();
      });
    });

    try {
      await Promise.all(framePromises);
      logger.info('All frames extracted successfully');

      // Check if we have enough frames to create a sprite sheet
      const extractedFrames = fs.readdirSync(framesDir).filter(f => f.startsWith('frame-'));

      if (extractedFrames.length < 2) {
        throw new Error(`Not enough frames extracted: ${extractedFrames.length}`);
      }

      // Create sprite sheet from extracted frames
      await new Promise<void>((resolve, reject) => {
        // Use FFmpeg to create a montage of images
        ffmpeg()
          .input(path.join(framesDir, 'frame-%03d.jpg'))
          .complexFilter([
            `[0:v] tile=${cols}x${rows}:padding=2:margin=4[out]`  // Dynamic grid dimensions
          ])
          .outputOptions(['-map [out]', '-frames:v 1', '-q:v 2']) // Higher quality output
          .output(spriteSheetPath)
          .on('end', () => {
            logger.info(`Sprite sheet created at: ${spriteSheetPath}`);
            resolve();
          })
          .on('error', (err) => {
            logger.error(`Failed to create sprite sheet: ${err.message}`);
            reject(err);
          })
          .run();
      });

      // Upload sprite sheet to S3
      const s3Key = `courses/chapters/videos/${objectId}/${spriteSheetFilename}`;
      const fileStream = fs.createReadStream(spriteSheetPath);

      const params = {
        Bucket: process.env.AWS_BUCKET_NAME_CONVERTED as string,
        Key: s3Key,
        Body: fileStream,
        ContentType: 'image/jpeg'
      };

      await s3.upload(params).promise();
      logger.info(`Sprite sheet uploaded to S3: ${s3Key}`);

      // Return the S3 key for the caller to use
      return s3Key;
    } finally {
      // Clean up temporary frames directory
      if (fs.existsSync(framesDir)) {
        fs.rmSync(framesDir, { recursive: true, force: true });
        logger.info(`Removed temporary frames directory: ${framesDir}`);
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Sprite sheet generation failed: ${errorMessage}`);
    throw err;
  }
};

// Helper function to create a blank frame if extraction fails
const createBlankFrame = async (outputPath: string, width: number, height: number): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('color=black:s=' + width + 'x' + height) // Create black frame
      .inputOptions(['-f lavfi']) // Force input format
      .outputOptions([
        '-frames:v 1',
        '-q:v 2'
      ])
      .output(outputPath)
      .on('end', () => {
        logger.info(`Created blank frame at ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        logger.error(`Failed to create blank frame: ${err.message}`);
        reject(err);
      })
      .run();
  });
};

// Add this helper function for thorough directory cleanup
const cleanupDirectory = (dirPath: string, removeDir: boolean = true): void => {
  try {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    // Read all items in the directory
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    // Process each item
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);

      if (item.isDirectory()) {
        // Recursively clean subdirectories
        cleanupDirectory(fullPath, true);
      } else {
        try {
          // Delete file
          fs.unlinkSync(fullPath);
          logger.info(`Deleted file: ${fullPath}`);
        } catch (err) {
          logger.error(`Failed to delete file ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Remove the directory itself if requested
    if (removeDir) {
      try {
        fs.rmdirSync(dirPath);
        logger.info(`Deleted directory: ${dirPath}`);
      } catch (err) {
        logger.error(`Failed to delete directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    logger.error(`Error during directory cleanup of ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const convertToHLS = async (videoPath: string, objectId: string): Promise<void> => {
  // No need to recreate the map here
  conversionStatus.set(objectId, 'converting');
  const hlsOutputDir = path.join(UPLOADS_DIR, 'hls', objectId);
  const outputDir = path.join(UPLOADS_DIR, objectId);
  let thumbnailPath = '';
  let thumbnailS3Key = '';
  let spriteSheetS3Key = '';

  try {
    logger.info(`Video path: ${videoPath}`);
    logger.info(`HLS output directory: ${hlsOutputDir}`);

    if (!fs.existsSync(hlsOutputDir)) {
      fs.mkdirSync(hlsOutputDir, { recursive: true });
      logger.info(`Created HLS output directory: ${hlsOutputDir}`);
    }

    // Create thumbnail
    try {
      thumbnailPath = await createThumbnail(videoPath, objectId);
      logger.info(`Thumbnail created successfully at: ${thumbnailPath}`);

      // Upload thumbnail to S3
      const thumbnailFilename = `${objectId}_thumbnail.jpg`;
      thumbnailS3Key = `courses/chapters/videos/${objectId}/${thumbnailFilename}`;

      const thumbnailFileStream = fs.createReadStream(thumbnailPath);
      const thumbnailParams = {
        Bucket: process.env.AWS_BUCKET_NAME_CONVERTED as string,
        Key: thumbnailS3Key,
        Body: thumbnailFileStream,
        ContentType: 'image/jpeg'
      };

      await s3.upload(thumbnailParams).promise();
      logger.info(`Thumbnail uploaded to S3: ${thumbnailS3Key}`);
    } catch (err) {
      logger.error(`Thumbnail creation/upload failed, continuing with conversion: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Create sprite sheet
    try {
      spriteSheetS3Key = await generateSpriteSheet(videoPath, objectId);
      logger.info(`Sprite sheet created successfully with S3 key: ${spriteSheetS3Key}`);
    } catch (err) {
      logger.error(`Sprite sheet generation failed, continuing with conversion: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { width: originalWidth, height: originalHeight } =
      await getVideoResolution(videoPath)
    logger.info(`Original video resolution: ${originalWidth}x${originalHeight}`)

    const resolutions = getDynamicResolutions(
      originalWidth,
      originalHeight,
      1.0
    )
    logger.info(
      `Target resolutions: ${resolutions.map((r) => r.name).join(', ')}`
    )

    const variantPlaylists: VariantPlaylist[] = []
    for (const { width, height, bitrate, crf, name } of resolutions) {
      const targetWidth = width
      const targetHeight = height
      const outputDir = path.join(hlsOutputDir, name.replace(' (source)', ''))
      const playlistPath = path.join(outputDir, 'index.m3u8')

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath)
          .output(playlistPath)
          .outputOptions([
            `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`,
            `-crf ${crf}`,
            '-profile:v high',
            '-level 4.1',
            '-preset faster',
            '-g 48',
            '-keyint_min 48',
            '-sc_threshold 0',
            '-hls_time 10',
            '-hls_list_size 0',
            '-f hls',
            '-hls_segment_type mpegts',
            '-hls_flags independent_segments',
            '-hls_playlist_type vod',
            '-movflags +faststart',
            '-c:v libx264',
            '-c:a aac',
            '-b:a 128k',
          ])
          .on('start', (command) => {
            logger.info(`Started FFmpeg for ${name}`);
          })
          .on('end', () => {
            variantPlaylists.push({
              width,
              height,
              bitrate,
              resolution: `${width}x${height}`,
              playlist: `${name.replace(' (source)', '')}/index.m3u8`,
            });
            resolve();
          })
          .on('error', (err) => {
            logger.error(`FFmpeg error: ${err.message}`)
            reject(err)
          })
          .run()
      })
    }

    // Generate master playlist
    const masterPlaylistContent = variantPlaylists
      .map((variant) => {
        const bandwidth = parseInt(variant.bitrate) * 1000 // Convert "555k" to 555000 bps
        return `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${variant.resolution}\n${variant.playlist}`
      })
      .join('\n')
    logger.info(`Master playlist created`);
    const masterPlaylistPath = path.join(hlsOutputDir, 'master.m3u8')
    fs.writeFileSync(masterPlaylistPath, `#EXTM3U\n${masterPlaylistContent}`)

    // Upload to S3
    conversionStatus.set(objectId, 'uploading')
    await uploadHlsFilesToS3(hlsOutputDir, objectId)
    conversionStatus.set(objectId, 'completed')
    logger.info(`Conversion completed for ${objectId}`)

    // Clean up all files
    try {
      // Delete original video file
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
        logger.info(`Deleted original video file: ${videoPath}`);
      }

      // Use our thorough cleanup function for the HLS directory
      cleanupDirectory(hlsOutputDir);

      // Use our thorough cleanup function for the output directory
      cleanupDirectory(outputDir);

      // Wait a bit to ensure all file operations are complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Also clean object-specific files in the uploads directory
      const uploadsFiles = fs.readdirSync(UPLOADS_DIR);
      for (const file of uploadsFiles) {
        const fullPath = path.join(UPLOADS_DIR, file);
        if (file.startsWith(objectId) && fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
          logger.info(`Deleted file: ${fullPath}`);
        }
      }

      // Finally, as a last check: verify uploads directory has no files matching objectId
      logger.info(`Final verification to ensure no files for ${objectId} remain`);

      // Recursively check that no files with objectId exist
      const checkForRemainingFiles = (dir: string): void => {
        if (!fs.existsSync(dir)) return;

        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);

          if (item.isDirectory()) {
            // Skip directories that are clearly not related to this objectId
            if (!item.name.includes(objectId) && !['hls'].includes(item.name)) {
              continue;
            }
            checkForRemainingFiles(fullPath);
          } else if (item.name.includes(objectId)) {
            logger.warn(`Found remaining file for ${objectId}: ${fullPath}`);
            try {
              fs.unlinkSync(fullPath);
              logger.info(`Deleted remaining file: ${fullPath}`);
            } catch (err) {
              logger.error(`Failed to delete remaining file ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      };

      checkForRemainingFiles(UPLOADS_DIR);

      logger.info(`Cleanup completed for ${objectId}`);
    } catch (cleanupErr) {
      // Log but don't fail if cleanup has issues
      logger.error(`Error during cleanup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`HLS conversion failed: ${errorMessage}`);
    console.error('Full error:', err);
    conversionStatus.set(objectId, 'error');
    throw err;
  } finally {
    // Even if the main process fails, attempt to clean up
    try {
      // Make one final attempt to clean up the object's directories
      const objectDirs = [
        path.join(UPLOADS_DIR, objectId),
        path.join(UPLOADS_DIR, 'hls', objectId)
      ];

      for (const dir of objectDirs) {
        if (fs.existsSync(dir)) {
          cleanupDirectory(dir);
          logger.info(`Final cleanup of directory: ${dir}`);
        }
      }
    } catch (finalCleanupErr) {
      logger.error(`Final cleanup attempt failed: ${finalCleanupErr instanceof Error ? finalCleanupErr.message : String(finalCleanupErr)}`);
    }
  }
}

const uploadHlsFilesToS3 = async (hlsOutputDir: string, objectId: string) => {
  const files: string[] = []
  const readDir = (dir: string): void => {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(dir, item.name)
      if (item.isDirectory()) {
        readDir(fullPath)
      } else {
        files.push(fullPath)
      }
    }
  }
  readDir(hlsOutputDir)

  // Use dynamic import for p-limit
  const pLimit = (await import('p-limit')).default;
  const uploadLimit = pLimit(5);

  const uploadPromises = files.map((filePath) => {
    const relativePath = path.relative(hlsOutputDir, filePath)
    const s3Key = `courses/chapters/videos/${objectId}/${relativePath}`

    return uploadLimit(async () => {
      try {
        const fileStream = fs.createReadStream(filePath)
        const params = {
          Bucket: process.env.AWS_BUCKET_NAME_CONVERTED as string,
          Key: s3Key,
          Body: fileStream,
          ContentType: filePath.endsWith('.m3u8')
            ? 'application/x-mpegURL'
            : 'video/MP2T',
        }

        await s3.upload(params).promise()
        logger.info(`Uploaded ${s3Key} to S3`)
      } catch (err) {
        logger.error(`Failed to upload ${s3Key}: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    })
  })

  await Promise.all(uploadPromises)
  logger.info(`All HLS files uploaded for ${objectId}`)
}

// Add a function to check conversion status
export const getConversionStatus = (objectId: string): string | undefined => {
  return conversionStatus.get(objectId);
}
