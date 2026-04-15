import { v4 as uuidv4 } from 'uuid';
import { GAME_CONSTANTS } from '../config';
import type { ConnectedClient, ServerMessage } from '../types';
import { getCharacterByWallet } from '../data/characters';

// === Chat System ===

const clients = new Map<string, ConnectedClient>();

export function registerChatClient(client: ConnectedClient): void {
  if (client.walletAddress) {
    clients.set(client.walletAddress, client);
  }
}

export function unregisterChatClient(walletAddress: string): void {
  clients.delete(walletAddress);
}

export function getChatClients(): Map<string, ConnectedClient> {
  return clients;
}

function sendMessage(client: ConnectedClient, message: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

/**
 * Check rate limit for a client. Returns true if allowed, false if rate limited.
 */
function checkRateLimit(client: ConnectedClient): boolean {
  const now = Date.now();
  if (now - client.lastChatTime < GAME_CONSTANTS.CHAT_RATE_LIMIT_MS) {
    return false;
  }
  client.lastChatTime = now;
  return true;
}

/**
 * Look up a character name from a wallet address.
 */
function getCharacterName(walletAddress: string): string {
  const character = getCharacterByWallet(walletAddress);
  return character?.name || walletAddress.slice(0, 8) + '...';
}

/**
 * Handle a chat message from a client.
 */
export function handleChatMessage(
  sender: ConnectedClient,
  content: string,
  target?: string // wallet address for whisper, undefined for global
): { success: boolean; error?: string } {
  if (!sender.walletAddress) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!content || content.trim().length === 0) {
    return { success: false, error: 'Empty message' };
  }

  if (content.length > 500) {
    return { success: false, error: 'Message too long (max 500 characters)' };
  }

  if (!checkRateLimit(sender)) {
    return { success: false, error: 'Rate limited. Wait 1 second between messages.' };
  }

  const sanitizedContent = content.trim();

  if (target) {
    // Whisper
    return sendWhisper(sender, target, sanitizedContent);
  } else {
    // Global
    return sendGlobalMessage(sender, sanitizedContent);
  }
}

/**
 * Send a global chat message to all connected clients.
 */
function sendGlobalMessage(sender: ConnectedClient, content: string): { success: boolean; error?: string } {
  const senderName = getCharacterName(sender.walletAddress!);

  const message: ServerMessage = {
    type: 'chat',
    message: {
      id: uuidv4(),
      sender: sender.walletAddress!,
      senderName,
      content,
      type: 'global',
      timestamp: Date.now(),
    },
  };

  for (const [, client] of clients) {
    sendMessage(client, message);
  }

  return { success: true };
}

/**
 * Send a whisper (private message) to a specific player.
 */
function sendWhisper(
  sender: ConnectedClient,
  targetWallet: string,
  content: string
): { success: boolean; error?: string } {
  const target = clients.get(targetWallet);
  if (!target) {
    return { success: false, error: 'Player not online' };
  }

  const senderName = getCharacterName(sender.walletAddress!);

  const message: ServerMessage = {
    type: 'chat',
    message: {
      id: uuidv4(),
      sender: sender.walletAddress!,
      senderName,
      content,
      type: 'whisper',
      target: targetWallet,
      timestamp: Date.now(),
    },
  };

  // Send to target
  sendMessage(target, message);

  // Also send back to sender as confirmation
  sendMessage(sender, message);

  return { success: true };
}

/**
 * Broadcast a system message to all connected clients.
 */
export function broadcastSystemMessage(content: string): void {
  const message: ServerMessage = {
    type: 'chat',
    message: {
      id: uuidv4(),
      sender: 'system',
      senderName: 'System',
      content,
      type: 'system',
      timestamp: Date.now(),
    },
  };

  for (const [, client] of clients) {
    sendMessage(client, message);
  }
}

/**
 * Send a system message to a specific client.
 */
export function sendSystemMessageTo(walletAddress: string, content: string): void {
  const client = clients.get(walletAddress);
  if (!client) return;

  const message: ServerMessage = {
    type: 'chat',
    message: {
      id: uuidv4(),
      sender: 'system',
      senderName: 'System',
      content,
      type: 'system',
      timestamp: Date.now(),
    },
  };

  sendMessage(client, message);
}
