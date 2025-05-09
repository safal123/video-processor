import * as dotenv from "dotenv";
import * as AWS from 'aws-sdk';

dotenv.config()

// Configure AWS SDK
const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
}

AWS.config.update(awsConfig)

const s3 = new AWS.S3()

export { s3 }
