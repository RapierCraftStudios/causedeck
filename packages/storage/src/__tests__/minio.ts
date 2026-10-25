// Testcontainers MinIO: the same image as the #5 dev stack.
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/** Keep in step with infra/docker/compose.dev.yml. */
export const MINIO_IMAGE = 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z';
export const MINIO_USER = 'minio-test-user';
export const MINIO_PASSWORD = 'minio-test-password-not-a-secret';

export interface StartedMinio {
  endpoint: string;
  createBucket: (name: string) => Promise<void>;
  stop: () => Promise<void>;
}

export async function startMinio(): Promise<StartedMinio> {
  const container: StartedTestContainer = await new GenericContainer(MINIO_IMAGE)
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: MINIO_USER, MINIO_ROOT_PASSWORD: MINIO_PASSWORD })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();
  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(9000))}`;
  const admin = new S3Client({
    endpoint,
    region: 'ap-south-1',
    forcePathStyle: true,
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
  });
  return {
    endpoint,
    createBucket: async (name) => {
      await admin.send(new CreateBucketCommand({ Bucket: name }));
    },
    stop: async () => {
      admin.destroy();
      await container.stop();
    },
  };
}
