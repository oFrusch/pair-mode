export interface KeyEvent {
  name: string;
  ctrl: boolean;
  text: string;
}

export interface MouseEvent {
  kind: "down" | "drag" | "up" | "scroll";
  button: number;
  row: number;
  column: number;
  shift: boolean;
}
