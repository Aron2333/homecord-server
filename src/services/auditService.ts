import { v4 as uuidv4 } from 'uuid';
import { query } from '../database/db.js';

export async function logAuditEvent(params: {
  serverId: string;
  actorId: string;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const id = uuidv4();
    await query(
      `INSERT INTO audit_logs (id, server_id, actor_id, action, target_id, target_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        params.serverId,
        params.actorId,
        params.action,
        params.targetId || null,
        params.targetType || null,
        params.metadata ? JSON.stringify(params.metadata) : null
      ]
    );
  } catch (error) {
    console.error('[AUDIT] Failed to log audit event:', error);
  }
}
