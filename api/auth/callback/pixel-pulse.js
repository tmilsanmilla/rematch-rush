import { servePixelRequest } from '../../../server/pixel-runtime.mjs';
export const GET = request => servePixelRequest(request, '/api/auth/callback/pixel-pulse');
