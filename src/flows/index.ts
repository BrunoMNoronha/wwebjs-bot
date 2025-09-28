import type { FlowModuleRegistry } from '../application/flows/FlowSessionService';
import { catalogFlow } from './catalog';
import { menuFlow } from './menu';

export const flowRegistry = {
  catalog: { flow: catalogFlow },
  menu: { flow: menuFlow },
} satisfies FlowModuleRegistry;

export default flowRegistry;
