export enum TipoConfirmacion {
  /** Aceptar */
  Pos,
  /** Yes, No */
  PosNeg,
  /** Aceptar, Cancelar */
  PosNeut,
  /** Rechazar, Cancelar */
  NegNeut,
  /** Yes, No, Cancel */
  PosNegNeut,
}

export enum TipoRespuestaConfirmacion {
  Positiva,
  Negativa,
  Neutral,
}
