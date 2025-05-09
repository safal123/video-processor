import fs from 'fs';
import { logger } from '../utils';
import * as path from "path";

// Get the project root directory without using import.meta
const rootDir = path.resolve(process.cwd());

/**
 * Create a folder for an object at the root level of the project
 * @param folderName Base folder name (e.g., 'uploads')
 * @param objectId Object ID to create a subfolder for
 * @returns Path to the created folder
 */
export const createFolderForObject = async (folderName: string, objectId: string): Promise<string> => {
  // Create path to the folder at root level
  const baseFolder = path.join(rootDir, folderName);
  const objectFolder = path.join(baseFolder, objectId);

  logger.info(`Creating folder at: ${objectFolder}`);

  try {
    // Create base folder if it doesn't exist
    if (!fs.existsSync(baseFolder)) {
      fs.mkdirSync(baseFolder, { recursive: true });
      logger.info(`Created base folder: ${baseFolder}`);
    }

    // Create object folder if it doesn't exist
    if (!fs.existsSync(objectFolder)) {
      fs.mkdirSync(objectFolder, { recursive: true });
      logger.info(`Created object folder: ${objectFolder}`);
    } else {
      logger.info(`Folder already exists: ${objectFolder}`);
    }

    return objectFolder;
  } catch (error) {
    logger.error(`Error creating folder: ${error}`);
    throw new Error(`Failed to create folder for object: ${objectId}`);
  }
};
