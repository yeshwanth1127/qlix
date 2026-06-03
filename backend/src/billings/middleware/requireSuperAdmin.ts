import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';

export async function requireSuperAdmin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = request.auth;
    if (!auth) {
      response.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { isSuperAdmin: true, isActive: true },
    });
    if (!user || !user.isActive || !user.isSuperAdmin) {
      response.status(403).json({ error: { code: 'forbidden', message: 'Super admin required' } });
      return;
    }
    next();
  } catch (error) {
    console.error('[requireSuperAdmin]', error);
    response.status(500).json({ error: { code: 'internal_error', message: 'Authorization failed' } });
  }
}

