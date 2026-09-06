'use client';

import { lazy, Suspense } from 'react';

const AiChatPanel = lazy(() => import('./ai-chat-panel'));

export default function LazyAiChat() {
  return (
    <Suspense fallback={null}>
      <AiChatPanel />
    </Suspense>
  );
}
