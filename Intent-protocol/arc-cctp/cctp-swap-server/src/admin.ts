import { timingSafeEqual } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSecret } from './secrets.js';

/** onRequest hook for /admin/* routes: constant-time compare of the x-admin-key header. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    const expected = getSecret('ADMIN_API_KEY');
    if (!expected) return reply.status(503).send({ error: 'admin API disabled (ADMIN_API_KEY not set)', code: 'UNAVAILABLE' });
    const got = req.headers['x-admin-key'];
    const a = Buffer.from(typeof got === 'string' ? got : '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.status(401).send({ error: 'unauthorized', code: 'UNAUTHORIZED' });
}
