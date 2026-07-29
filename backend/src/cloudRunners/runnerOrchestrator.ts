import {
  dockerBuildImage,
  dockerEnsureNetwork,
  dockerImageExists,
  dockerIsAvailable,
  dockerListImages,
  dockerLogs,
  dockerRemoveContainerIfExists,
  dockerRemoveImageIfExists,
  dockerRunDetached,
  DockerNotAvailableError,
} from './dockerClient.js';

export interface BuildRunnerImageInput {
  imageRef: string;
  dockerfilePath: string;
  contextPath: string;
}

export interface RunRunnerContainerInput {
  name: string;
  imageRef: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  network?: string;
  mounts?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  cmd?: string[];
  memoryLimit?: string;
  memoryReservation?: string;
  cpuLimit?: string;
  pidsLimit?: string;
}

export interface RunnerOrchestrator {
  ensureAvailable(): Promise<void>;
  ensureNetwork(networkName: string): Promise<void>;
  buildImage(input: BuildRunnerImageInput): Promise<void>;
  imageExists(imageRef: string): Promise<boolean>;
  runContainer(input: RunRunnerContainerInput): Promise<string>;
  removeContainerIfExists(containerName: string): Promise<void>;
  logs(containerName: string, tail?: number): Promise<string>;
  listImages(referencePrefix: string): Promise<string[]>;
  removeImageIfExists(imageRef: string): Promise<void>;
}

export class DockerRunnerOrchestrator implements RunnerOrchestrator {
  async ensureAvailable(): Promise<void> {
    const ok = await dockerIsAvailable();
    if (!ok) throw new DockerNotAvailableError();
  }

  async ensureNetwork(networkName: string): Promise<void> {
    await dockerEnsureNetwork(networkName);
  }

  async buildImage(input: BuildRunnerImageInput): Promise<void> {
    await dockerBuildImage(input);
  }

  async imageExists(imageRef: string): Promise<boolean> {
    return dockerImageExists(imageRef);
  }

  async runContainer(input: RunRunnerContainerInput): Promise<string> {
    return dockerRunDetached({
      name: input.name,
      imageRef: input.imageRef,
      env: input.env,
      labels: input.labels,
      network: input.network,
      mounts: input.mounts,
      cmd: input.cmd,
      memoryLimit: input.memoryLimit,
      memoryReservation: input.memoryReservation,
      cpuLimit: input.cpuLimit,
      pidsLimit: input.pidsLimit,
    });
  }

  async removeContainerIfExists(containerName: string): Promise<void> {
    await dockerRemoveContainerIfExists(containerName);
  }

  async logs(containerName: string, tail = 200): Promise<string> {
    return dockerLogs({ name: containerName, tail });
  }

  async listImages(referencePrefix: string): Promise<string[]> {
    return dockerListImages(referencePrefix);
  }

  async removeImageIfExists(imageRef: string): Promise<void> {
    await dockerRemoveImageIfExists(imageRef);
  }
}

