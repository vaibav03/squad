import { useState } from 'react';
import { CallPanel } from './CallPanel';
import { QuizCard } from './QuizCard';
import { ConfirmSheet } from './ConfirmSheet';
import { callPanelFixtures, confirmSheetFixtures, quizCardFixtures } from './fixtures';
import type { GalleryStory } from './kit';
import type { CallPanelProps } from './types';

/** Night-village stand-in behind overlays so screenshots read like the real stage. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sq-scene"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 640,
        overflow: 'hidden',
        background:
          'linear-gradient(180deg, var(--sq-sky-deep) 0%, var(--sq-sky-mid) 55%, var(--sq-sky-low) 78%, var(--sq-hill-mid) 78%, var(--sq-hill-near) 90%, var(--sq-ground) 90%)',
      }}
    >
      {children}
    </div>
  );
}

function LiveCall({ initial }: { initial: CallPanelProps }) {
  const [muted, setMuted] = useState(initial.muted);
  const [hand, setHand] = useState(initial.handRaised);
  return <CallPanel {...initial} muted={muted} onMuteChange={setMuted} handRaised={hand} onHandRaiseChange={setHand} />;
}

const call = Object.entries(callPanelFixtures).map(
  ([k, props]): GalleryStory => ({
    id: `call-${k}`,
    title: `Call panel: ${k}`,
    render: () => (
      <Stage>
        <LiveCall initial={props as CallPanelProps} />
      </Stage>
    ),
  }),
);
const quiz = Object.entries(quizCardFixtures).map(
  ([k, props]): GalleryStory => ({
    id: `quiz-${k}`,
    title: `Quiz card: ${k}`,
    render: () => (
      <Stage>
        <QuizCard {...props} />
      </Stage>
    ),
  }),
);
const confirm = Object.entries(confirmSheetFixtures).map(
  ([k, props]): GalleryStory => ({
    id: `confirm-${k}`,
    title: `Confirm sheet: ${k}`,
    render: () => (
      <Stage>
        <ConfirmSheet {...props} />
      </Stage>
    ),
  }),
);

export const stories: GalleryStory[] = [...call, ...quiz, ...confirm];
