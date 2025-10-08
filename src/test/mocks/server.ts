/**
 * Mock Service Worker server setup for testing
 */

import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock handlers for Supabase API
const handlers = [
  // Mock auth endpoint
  http.post('*/auth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'mock-token',
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'test@example.com'
      }
    });
  }),

  // Mock database queries
  http.get('*/rest/v1/*', () => {
    return HttpResponse.json([]);
  }),

  http.post('*/rest/v1/*', () => {
    return HttpResponse.json({
      id: 'mock-id',
      created_at: new Date().toISOString()
    });
  }),
];

export const server = setupServer(...handlers);