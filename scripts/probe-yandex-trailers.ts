import { MusicService } from '../server/music';

const music = new MusicService();
const results = await music.probe(10);

for (const result of results) {
  const status = result.hasAudio ? 'OK' : 'NO_AUDIO';
  console.log(`${status} ${result.id} ${result.title}`);
  if (result.audioUrl) {
    console.log(`  ${result.audioUrl}`);
  }
}
