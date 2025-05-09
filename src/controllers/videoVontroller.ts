import { RequestHandler } from 'express';
import { logger } from '../utils';
import { createFolderForObject } from '../services/fileService';
import { downloadFileUsingSignedUrl, uploadImageToS3 } from '../services/s3Service';
import { convertToHLS, createThumbnail, generateSpriteSheet } from '../services/videoService';
import { s3 } from '../config';
import * as path from 'path';
import * as fs from 'fs';

export const convertToHls: RequestHandler = async (req, res) => {
  const objectId = req.query.objectId?.toString().replace(/[^a-zA-Z0-9-_]/g, '');
  // TODO: Remove this once we have a proper way to handle the thumbnail creation
  const shouldCreateThumbnail = true;

  if (!objectId) {
    logger.error('ObjectId is required');
    res.status(400).json({ error: 'ObjectId is required' });
    return;
  }

  try {
    const bucketName = process.env.AWS_BUCKET_NAME as string;
    const key = `courses/chapters/videos/${objectId}`;

    // Generate signed URL
    const params = {
      Bucket: bucketName,
      Key: key,
      Expires: 3600,
    };

    const signedUrl = s3.getSignedUrl('getObject', params);
    logger.info(`Generated signed URL for object: ${key}`);

    // Create folder for the object - with direct error handling
    let folderPath;
    try {
      // First, ensure the uploads directory exists with proper permissions
      const rootDir = process.cwd();
      logger.info(`Current working directory: ${rootDir}`);

      const uploadsDir = path.join(rootDir, 'uploads');
      logger.info(`Uploads directory path: ${uploadsDir}`);

      if (!fs.existsSync(uploadsDir)) {
        logger.info(`Creating uploads directory at: ${uploadsDir}`);
        fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o777 });
      }

      // Now create the object folder
      folderPath = path.join(uploadsDir, objectId);
      logger.info(`Creating object folder at: ${folderPath}`);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true, mode: 0o777 });
      }

      logger.info(`Successfully created folder at: ${folderPath}`);
    } catch (folderError) {
      logger.error(`Error creating folder directly: ${folderError}`);
      res.status(500).json({
        error: 'Failed to create folder for object',
        details: folderError instanceof Error ? folderError.message : String(folderError),
        cwd: process.cwd()
      });
      return;
    }

    // Create a file path by appending a filename to the folder path
    const filename = 'original.mp4'; // Or extract filename from the S3 key
    const filePath = path.join(folderPath, filename);
    logger.info(`File path for download: ${filePath}`);

    // Download the file to the file path (not the folder path)
    await downloadFileUsingSignedUrl(signedUrl, filePath);

    if (shouldCreateThumbnail) {
      logger.info(`Creating thumbnail for video: ${filePath}`);
      const thumbnailPath = await createThumbnail(filePath, objectId);
      logger.info(`Thumbnail created at: ${thumbnailPath}`);
      // Upload the thumbnail to S3
      const thumbnailUrl = await uploadImageToS3(thumbnailPath, objectId);
      logger.info(`Thumbnail uploaded to S3: ${thumbnailUrl}`);
    }

    await generateSpriteSheet(filePath, objectId);

    // Convert to HLS
    await convertToHLS(filePath, objectId);

    // Generate sprite sheet

    res.json({
      url: signedUrl,
      filePath: filePath,
    });
  } catch (error) {
    logger.error('Error processing request:', error);
    res.status(500).json({
      error: 'Failed to process request',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};