import axios from "axios";
import { s3 } from "../config";
import { logger } from "../utils";
import fs from 'fs';
import path from 'path';

/**
 * Generate a signed URL for accessing an object in S3
 * @param bucketName - The name of the S3 bucket containing the object
 * @param key - The key (path) of the object in the S3 bucket
 * @returns A pre-signed URL that provides temporary access to the object
 */
export const generateSignedUrl = async (bucketName: string, key: string): Promise<string> => {
  logger.info(`Generating signed URL for object: ${key}`);

  // Configure parameters for the signed URL
  const params = {
    Bucket: bucketName,
    Key: key,
    Expires: 3600, // URL expires in 1 hour
  };

  try {
    // Generate the signed URL using AWS SDK
    const signedUrl = s3.getSignedUrl('getObject', params);
    logger.info(`Successfully generated signed URL for: ${key}`);
    return signedUrl;
  } catch (error) {
    logger.error(`Failed to generate signed URL for: ${key}`, error);
    throw new Error('Failed to generate signed URL');
  }
};

/**
 * Download a file from a signed URL and save it to a local file path
 * @param signedUrl - The pre-signed URL to download the file from
 * @param localFilePath - The local file path where the downloaded file will be saved
 * @returns Object containing download status, message, file path and size
 */
export const downloadFileUsingSignedUrl = async (signedUrl: string, localFilePath: string): Promise<{
  success: boolean;
  message: string;
  filePath: string;
  size: number
}> => {
  try {
    logger.info(`Starting download to: ${localFilePath}`);

    // Make HTTP request to download the file
    const response = await axios({
      method: 'GET',
      url: signedUrl,
      responseType: 'stream', // Stream the response to handle large files efficiently
      timeout: 30000, // 30 second timeout to prevent hanging requests
      headers: {
        'Accept': '*/*', // Accept any content type
      }
    });

    // Validate the response status
    logger.info(`Response status: ${response.status}`);
    if (response.status !== 200) {
      logger.error(`Error response with status: ${response.status}`);
      throw new Error(`Failed with status ${response.status}`);
    }

    // Ensure the target directory exists
    const dir = path.dirname(localFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create a write stream to save the file
    const writer = fs.createWriteStream(localFilePath);

    // Pipe the response data to the file
    response.data.pipe(writer);

    // Wait for the download to complete or fail
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', (err) => {
        // Clean up partial file on write error
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
        }
        reject(err);
      });
      // Handle errors in the response stream
      response.data.on('error', reject);
    });

    // Verify the downloaded file has content
    const stats = fs.statSync(localFilePath);
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty');
    }

    logger.info(`File successfully downloaded to: ${localFilePath} (${stats.size} bytes)`);

    // Return success response with file details
    return {
      success: true,
      message: 'File downloaded successfully',
      filePath: localFilePath,
      size: stats.size
    };
  } catch (error: any) {
    logger.error(`Error downloading file: ${error.message}`, error);

    // Clean up partial file if download failed
    if (fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
        logger.info(`Cleaned up partial file: ${localFilePath}`);
      } catch (cleanupError: unknown) {
        const errorMessage = cleanupError instanceof Error
          ? cleanupError.message
          : 'Unknown error';
        logger.error(`Failed to clean up partial file: ${errorMessage}`);
      }
    }

    throw new Error(`Failed to download file: ${error.message}`);
  }
};

/**
 * Upload an image to S3 storage
 * @param imagePath - Local path to the image file
 * @param objectId - Unique identifier for the object
 * @param options - Optional configuration for the upload
 * @returns Promise that resolves when upload is complete
 */
export const uploadImageToS3 = async (
  imagePath: string,
  objectId: string,
  options: {
    folder?: string;
    filename?: string;
    contentType?: string;
  } = {}
): Promise<string> => {
  const {
    folder = 'courses/images',
    filename = `${objectId}_thumbnail.jpg`,
    contentType = 'image/jpeg'
  } = options;

  const fileStream = fs.createReadStream(imagePath);
  logger.info(`Uploading image to S3 for object: ${objectId}`);

  const bucketName = process.env.AWS_BUCKET_NAME_CONVERTED;
  if (!bucketName) {
    throw new Error('AWS_BUCKET_NAME is not defined');
  }

  const key = `${folder}/${filename}`;

  logger.info(`Uploading image to bucket: ${bucketName} with key: ${key}`);
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: fileStream,
    ContentType: contentType,
  };

  try {
    const result = await s3.upload(params).promise();
    logger.info(`Image uploaded to S3: ${result.Location}`);
    return result.Location; // Return the URL of the uploaded image
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Image upload failed: ${errorMessage}`);
    throw err;
  }
};
