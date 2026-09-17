# Scenic route image register

Last reviewed: 2026-09-15

The Routes catalogue uses photographs whose Wikimedia Commons file pages record a reusable Creative Commons licence. This register is the project’s attribution and provenance record. It is not legal advice and no third-party asset can be represented as having literally zero legal risk; release owners should re-check each linked file page before redistribution.

The app loads the exact Wikimedia-hosted image or 1280-pixel thumbnail URL recorded for each route. This avoids the rate-limited `Special:FilePath` redirect service while preserving the original Commons source and licence links. It does not remove watermarks or embedded metadata. Cards and overviews use responsive display cropping; the underlying files are otherwise unmodified.

| Route | Photograph | Creator | Licence | Source |
| --- | --- | --- | --- | --- |
| Hartside Pass | The A686 below Hartside | Andrew Smith | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:The_A686_below_Hartside_-_geograph.org.uk_-_1073084.jpg) |
| Glencoe Run | A82 towards Glencoe | N Chadwick | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:A82_towards_Glencoe_-_geograph.org.uk_-_3149881.jpg) |
| SnowRoads | Cairngorms National Park road | Milada Vigerova | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Cairngorms_National_Park_road_(Unsplash).jpg) |
| Cambrian Spine | A470 at Bwlch Oerddrws | Martin Bodman | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:A470_at_Bwlch_Oerddrws.jpg) |
| Causeway Coast | Causeway Coastal Route, Dunseverick | David Dixon | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Causeway_Coastal_Route,_Dunseverick_-_geograph.org.uk_-_5572416.jpg) |
| Wye Valley Sweep | A466 Wye valley road | Jonathan Billinger | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:A466_Wye_valley_road_-_geograph.org.uk_-_1402565.jpg) |

## Reuse requirements

- Keep creator attribution, file source, licence name, and licence URL visible from the route overview.
- Do not imply that a photographer, Wikimedia Commons, Geograph, or a tourism publisher endorses Rider Comms.
- If a CC BY-SA image is downloaded, modified, or redistributed rather than merely rendered from its source, retain the same or a compatible licence for the adapted image and describe the change.
- Before replacing an image, record the exact file-page URL and licence—not a search-result, article, social-media post, or generic stock-site homepage.
- Do not use tourism-board editorial images unless separate commercial reuse permission is documented.

## Operational limitation

Remote image hosting is convenient for the prototype but is not a production media pipeline. Before a store release, copy approved assets to a controlled CDN/object store, retain this attribution register and original source metadata, add cache/error monitoring, and complete a final rights review.
