const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function backupDatabase() {
  const tmpDir = path.join(process.cwd(), '.tmp');

  // Ensure .tmp directory exists
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }

  const s3Client = new S3Client({
    credentials: {
      accessKeyId: process.env.CONTABO_ACCESS_KEY_ID,
      secretAccessKey: process.env.CONTABO_ACCESS_SECRET,
    },
    endpoint: `https://${process.env.CONTABO_BUCKET_REGION}.contabostorage.com`,
    forcePathStyle: true,
    region: process.env.CONTABO_BUCKET_REGION,
    params: {
      ACL: process.env.AWS_ACL,
      Bucket: process.env.CONTABO_BUCKET_NAME,
    },
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (process.env.DB_TYPE === 'postgres') {
    const dumpFile = path.join(tmpDir, `backup-${timestamp}.sql`);

    // Create PostgreSQL dump
    const pgDumpCommand = `PGPASSWORD="${process.env.DB_PASSWORD}" pg_dump -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} > ${dumpFile}`;

    try {
      await new Promise((resolve, reject) => {
        exec(pgDumpCommand, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // Upload to S3
      const fileContent = fs.readFileSync(dumpFile);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.CONTABO_BUCKET_NAME,
          Key: `backups/postgres/${path.basename(dumpFile)}`,
          Body: fileContent,
        }),
      );

      // Clean up local dump file
      fs.unlinkSync(dumpFile);
    } catch (error) {
      console.error('Error during PostgreSQL backup:', error);
      throw error;
    }
  } else if (process.env.DB_TYPE === 'sqlite') {
    if (!process.env.DB_PATH) {
      throw new Error('DB_PATH is required for SQLite backup');
    }

    try {
      const dbFile = process.env.DB_PATH;
      const backupFile = path.join(tmpDir, `backup-${timestamp}.sqlite`);

      // Copy SQLite file
      fs.copyFileSync(dbFile, backupFile);

      // Upload to S3
      const fileContent = fs.readFileSync(backupFile);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.CONTABO_BUCKET_NAME,
          Key: `backups/sqlite/${path.basename(backupFile)}`,
          Body: fileContent,
        }),
      );

      // Clean up local backup file
      fs.unlinkSync(backupFile);
    } catch (error) {
      console.error('Error during SQLite backup:', error);
      throw error;
    }
  } else {
    throw new Error(`Unsupported database type: ${process.env.DB_TYPE}`);
  }
}

backupDatabase()
