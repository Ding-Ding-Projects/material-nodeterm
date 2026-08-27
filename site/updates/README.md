# /updates

The active Windows update feed comes from each stable GitHub Release. Packaged builds read the
Squirrel `RELEASES` index and its referenced full `.nupkg` directly from immutable release asset
URLs.

This directory is retained only as a historical location marker. Do not place current installers
or update packages here, and do not point a Windows build at this static directory. Current update
assets belong on the verified release that built them.
