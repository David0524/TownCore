import { describe, expect, it } from 'vitest';
import { swagitVideo, tidyTranscript } from '../src/swagit';

describe('swagit', () => {
  it('recognizes Swagit video pages only', () => {
    expect(swagitVideo('https://jupiterfl.new.swagit.com/videos/403164')).toEqual({
      page: 'https://jupiterfl.new.swagit.com/videos/403164',
      id: '403164',
    });
    expect(swagitVideo('https://TamaracFL.swagit.com/videos/12/download')?.page).toBe(
      'https://tamaracfl.swagit.com/videos/12',
    );
    expect(swagitVideo('https://www.jupiter.fl.us/1218/Live-Council-Meetings')).toBeNull();
    expect(swagitVideo('http://jupiterfl.new.swagit.com/videos/1')).toBeNull();
    expect(swagitVideo(null)).toBeNull();
  });

  it('drops timestamps and extra spacing but keeps agenda markers and wording', () => {
    const raw = [
      '          [00:00:01]',
      '          GOOD EVENING.   THE TIME IS NOW 7 P.M. ',
      '          [1. Proclaiming "Customer Service Week". # ]',
      '',
      'WHICH I WILL BE PRESENTING.',
    ].join('\r\n');
    expect(tidyTranscript(raw)).toBe(
      [
        'GOOD EVENING. THE TIME IS NOW 7 P.M.',
        '[1. Proclaiming "Customer Service Week". # ]',
        'WHICH I WILL BE PRESENTING.',
      ].join('\n'),
    );
  });
});
