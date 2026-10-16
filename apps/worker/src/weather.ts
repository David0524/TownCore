// The Today weather tile (docs/plans/M4b.md): the worker refreshes every active town's NWS
// snapshot on a schedule. The refresh itself lives in the pipeline, shared with the town sites'
// refresh-on-view (apps/web/src/lib/weather.ts).
export { refreshWeather, weatherTargets } from '@towncore/pipeline';
