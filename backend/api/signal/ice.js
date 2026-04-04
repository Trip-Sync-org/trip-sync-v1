/**
 * GET /api/signal/ice — returns public STUN URLs (browser WebRTC / Google STUN — no paid API).
 * To add TURN servers later (for corporate firewalls/NAT), add them here. Cloudflare TURN has a free tier at cloudflare.com/products/cloudflare-spectrum
 */

import { handleOptions, sendError } from '../../lib/permissions.js';
import { ICE_SERVERS } from '../../../shared/voiceConstants.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    res.status(200).json({
      iceServers: ICE_SERVERS.map((s) => ({ ...s })),
    });
  } catch (err) {
    sendError(res, err);
  }
}
