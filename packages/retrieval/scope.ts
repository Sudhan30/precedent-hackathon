import {z} from 'zod';
export const memoryScopeSchema=z.object({tenantId:z.string().min(1).max(100),role:z.enum(['employee','admin'])});
export type MemoryScope=z.infer<typeof memoryScopeSchema>;
export function visibleEpisode(episode:Record<string,any>,scope:MemoryScope,sessionId:string,resourceId:string){
 // Warehouse results are department data: they become reusable only as approved,
 // department-scoped agent memory (packages/knowledge), never as tenant-wide episodes.
 return episode.resourceId!=='warehouse'&&episode.tenantId===scope.tenantId&&Array.isArray(episode.visibleRoles)&&episode.visibleRoles.includes(scope.role)&&episode.sessionId!==sessionId&&episode.resourceId===resourceId;
}
