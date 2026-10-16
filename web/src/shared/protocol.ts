export type Facing = 'user' | 'environment';
export type Tally = 'program' | 'preview' | 'off';

export interface CameraInfo {
  id: string;
  name: string;
  facing: Facing;
}

export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalData = { sdp: SessionDescription } | { candidate: IceCandidate };

export type ClientMsg =
  | { t: 'hello'; role: 'camera'; camera: CameraInfo }
  | { t: 'hello'; role: 'director' }
  | { t: 'update'; camera: Omit<CameraInfo, 'id'> }
  | { t: 'signal'; to?: string; data: SignalData }
  | { t: 'tally'; to: string; state: Tally }
  | { t: 'kick'; to: string }
  | { t: 'rename'; to: string; name: string };

export type ServerMsg =
  | { t: 'cameras'; list: CameraInfo[] }
  | { t: 'camera-joined'; camera: CameraInfo }
  | { t: 'camera-updated'; camera: CameraInfo }
  | { t: 'camera-left'; id: string }
  | { t: 'director-ready' }
  | { t: 'director-gone' }
  | { t: 'signal'; from: string; data: SignalData }
  | { t: 'tally'; state: Tally }
  | { t: 'renamed'; name: string }
  | { t: 'kicked' }
  | { t: 'error'; message: string };

export const DIRECTOR_ID = 'director';
