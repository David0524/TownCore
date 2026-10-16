'use client';

import { useState } from 'react';
import styles from './news.module.css';

/**
 * A meeting's YouTube video, click to play (owner's decision, 2026-10-16). Until the reader
 * presses play nothing loads from YouTube: no thumbnail (Rule 9: no images from other sites) and
 * no third-party request or cookie (D-M4-3). The player then comes from youtube-nocookie.com.
 * The box keeps a 16:9 shape either way, so nothing shifts (CLS).
 */
export function MeetingVideo({
  videoId,
  title,
  channel,
}: {
  videoId: string;
  title: string;
  channel: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return (
    <section
      className={styles.meetingVideo}
      aria-labelledby="meeting-video-h"
      data-testid="meeting-video"
    >
      <h2 id="meeting-video-h">Watch the meeting</h2>
      <div className={styles.videoFrame}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            data-testid="meeting-video-player"
          />
        ) : (
          <button
            type="button"
            className={styles.videoPoster}
            onClick={() => setPlaying(true)}
            data-testid="meeting-video-play"
          >
            <svg viewBox="0 0 48 48" aria-hidden="true" className={styles.videoPlay}>
              <circle cx="24" cy="24" r="23" />
              <path d="M19 15.5v17l14-8.5z" />
            </svg>
            <span className={styles.videoTitle}>{title}</span>
            <span className="meta">Play video</span>
          </button>
        )}
      </div>
      <p className={`meta ${styles.videoCredit}`} data-testid="meeting-video-credit">
        Video{channel ? `: ${channel}` : ''}, on{' '}
        <a href={watch} rel="nofollow noopener" target="_blank">
          YouTube
        </a>
        . It loads from YouTube when you press play.
      </p>
    </section>
  );
}
