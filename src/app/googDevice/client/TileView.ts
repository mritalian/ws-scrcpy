import '../../../style/tileview.css';
import { StreamClientScrcpy } from './StreamClientScrcpy';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { MsePlayer } from '../../player/MsePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ACTION } from '../../../common/Action';
import { DeviceState } from '../../../common/DeviceState';

export type TileEntry = {
    descriptor: GoogDeviceDescriptor;
    ws: string;
};

type TileSlot = {
    stream: StreamClientScrcpy;
    cell: HTMLElement;
};

export class TileView {
    private readonly overlay: HTMLElement;
    private readonly grid: HTMLElement;
    private readonly titleEl: HTMLSpanElement;
    private readonly streamMap = new Map<string, TileSlot>();

    constructor(entries: TileEntry[], onClose: () => void) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'tile-overlay';

        const toolbar = document.createElement('div');
        toolbar.className = 'tile-toolbar';

        this.titleEl = document.createElement('span');
        this.titleEl.className = 'tile-toolbar-title';
        toolbar.appendChild(this.titleEl);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tile-close-button';
        closeBtn.innerText = 'Close tile view';
        closeBtn.onclick = () => this.close(onClose);
        toolbar.appendChild(closeBtn);

        this.overlay.appendChild(toolbar);

        this.grid = document.createElement('div');
        this.grid.className = 'tile-grid';
        this.overlay.appendChild(this.grid);

        document.body.appendChild(this.overlay);
        window.addEventListener('resize', this.onWindowResize);

        entries.forEach(({ descriptor, ws }) => this.addTile(descriptor, ws));
        this.relayout();
    }

    public updateDevices(descriptors: GoogDeviceDescriptor[], getWsUrl: (udid: string) => string): void {
        const nowActive = new Set(
            descriptors
                .filter((d) => d.state === DeviceState.DEVICE && d.pid !== -1)
                .map((d) => d.udid),
        );

        for (const [udid, { stream, cell }] of this.streamMap) {
            if (!nowActive.has(udid)) {
                stream.stop();
                cell.remove();
                this.streamMap.delete(udid);
            }
        }

        for (const descriptor of descriptors) {
            if (descriptor.state === DeviceState.DEVICE && descriptor.pid !== -1 && !this.streamMap.has(descriptor.udid)) {
                this.addTile(descriptor, getWsUrl(descriptor.udid));
            }
        }

        this.relayout();
    }

    private addTile(descriptor: GoogDeviceDescriptor, ws: string): void {
        const { udid } = descriptor;

        const cell = document.createElement('div');
        cell.className = 'tile-cell';

        const heading = document.createElement('div');
        heading.className = 'tile-heading';
        const manufacturer = descriptor['ro.product.manufacturer'] || '';
        const model = descriptor['ro.product.model'] || '';
        heading.innerText = [manufacturer, model].filter(Boolean).join(' ') || udid;
        heading.title = udid;
        cell.appendChild(heading);

        const streamContainer = document.createElement('div');
        streamContainer.className = 'tile-stream-container';
        cell.appendChild(streamContainer);

        this.grid.appendChild(cell);

        const params = {
            action: ACTION.STREAM_SCRCPY as ACTION.STREAM_SCRCPY,
            udid,
            ws,
            player: MsePlayer.playerCodeName,
        };
        const streamReceiver = new StreamReceiverScrcpy(params);
        const player = new MsePlayer(udid);
        const stream = StreamClientScrcpy.start(params, streamReceiver, player, true, undefined, streamContainer);

        this.streamMap.set(udid, { stream, cell });
    }

    private onWindowResize = (): void => {
        this.relayout();
    };

    private relayout(): void {
        const n = this.streamMap.size;
        if (n === 0) {
            this.titleEl.innerText = 'Tile view — waiting for devices';
            this.grid.style.gridTemplateColumns = '';
            this.grid.style.gridTemplateRows = '';
            return;
        }
        const cols = this.computeOptimalCols(n);
        const rows = Math.ceil(n / cols);
        this.grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        this.grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        this.titleEl.innerText = `Tile view — ${n} device${n !== 1 ? 's' : ''}`;
    }

    // Pick the column count that maximises the rendered area of a portrait phone
    // (9:16 aspect ratio) inside each tile. Tries every possible column count
    // from 1 to N and picks the winner — this naturally prefers fewer rows when
    // the window is landscape and phones are portrait.
    private computeOptimalCols(n: number): number {
        const W = this.grid.clientWidth || window.innerWidth;
        const H = this.grid.clientHeight || window.innerHeight;
        const PHONE_ASPECT = 9 / 16; // width / height
        const HEADING_PX = 22;       // approximate per-tile heading bar height

        let bestCols = 1;
        let bestArea = 0;

        for (let cols = 1; cols <= n; cols++) {
            const rows = Math.ceil(n / cols);
            const tileW = W / cols;
            const tileH = H / rows - HEADING_PX;
            if (tileH <= 0) {
                continue;
            }
            // Area of phone content that would be visible (object-fit: contain)
            let area: number;
            if (tileW / tileH > PHONE_ASPECT) {
                // Tile is wider than phone → height-constrained
                area = tileH * tileH * PHONE_ASPECT;
            } else {
                // Tile is narrower than phone → width-constrained
                area = tileW * tileW / PHONE_ASPECT;
            }
            if (area > bestArea) {
                bestArea = area;
                bestCols = cols;
            }
        }

        return bestCols;
    }

    private close(onClose: () => void): void {
        window.removeEventListener('resize', this.onWindowResize);
        for (const { stream } of this.streamMap.values()) {
            stream.stop();
        }
        this.streamMap.clear();
        this.overlay.remove();
        onClose();
    }
}
