export interface PositionSetting {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export interface AppSettings {
  APIKey: string
  instanceLocation: string
  position: PositionSetting
}
