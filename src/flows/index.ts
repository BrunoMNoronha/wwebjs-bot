import type { FlowModuleRegistry } from '../application/flows/FlowSessionService';
import { catalogFlow } from './catalog';
import { menuFlow } from './menu';

export const flowRegistry: FlowModuleRegistry = {
  catalog: { flow: catalogFlow },
  menu: { flow: menuFlow },
};

export default flowRegistry;
