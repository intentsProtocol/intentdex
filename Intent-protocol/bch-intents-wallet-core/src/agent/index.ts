/**
 * The on-device agent: tools, turn loop, chats and the outbox. Shared by the phone app and the extension;
 * each host brings its own LlmClient (QVAC in process, or QVAC's local HTTP server).
 */
export * from './types';
export * from './amount';
export * from './resolve';
export * from './strategies';
export * from './loan';
export * from './tools';
export * from './prompts';
export * from './chat';
export * from './loop';
export * from './quick';
export * from './snapshot';
