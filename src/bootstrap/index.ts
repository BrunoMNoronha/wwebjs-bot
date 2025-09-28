import { config as loadEnv } from 'dotenv';
import { createApplicationContainer, type ApplicationContainer, type ApplicationContainerOptions } from '../application/container';

export type BootstrapOptions = ApplicationContainerOptions;

export function initializeApplication(options: BootstrapOptions = {}): ApplicationContainer {
  loadEnv();
  return createApplicationContainer(options);
}
