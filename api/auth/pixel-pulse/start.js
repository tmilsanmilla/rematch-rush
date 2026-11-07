import { servePixelRequest } from '../../../server/pixel-runtime.mjs';
export const POST = request => servePixelRequest(request, '/api/auth/pixel-pulse/start');
