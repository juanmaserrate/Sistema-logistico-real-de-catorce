import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';

/** Los tres proveedores de envases. El orden es el que ve el chofer.
 *  Tiene que coincidir con PROVEEDORES_CAJONES del servidor. */
export const PROVEEDORES = [
  { nombre: 'PECO', dej: 'cratesDeliveredPeco', rec: 'cratesRecoveredPeco' },
  { nombre: 'PLÁSTICOS', dej: 'cratesDeliveredPlasticos', rec: 'cratesRecoveredPlasticos' },
  { nombre: 'BURZACO', dej: 'cratesDeliveredBurzaco', rec: 'cratesRecoveredBurzaco' },
] as const;

export type CajonesProveedor = {
  cratesDeliveredPeco: number | null;
  cratesRecoveredPeco: number | null;
  cratesDeliveredPlasticos: number | null;
  cratesRecoveredPlasticos: number | null;
  cratesDeliveredBurzaco: number | null;
  cratesRecoveredBurzaco: number | null;
};

export const CAJONES_VACIO: CajonesProveedor = {
  cratesDeliveredPeco: null,
  cratesRecoveredPeco: null,
  cratesDeliveredPlasticos: null,
  cratesRecoveredPlasticos: null,
  cratesDeliveredBurzaco: null,
  cratesRecoveredBurzaco: null,
};

/** Lo que ya tiene cargado la parada. */
export function cajonesDeLaParada(stop: any): CajonesProveedor {
  const v: any = {};
  for (const k of Object.keys(CAJONES_VACIO)) v[k] = stop?.[k] ?? null;
  return v as CajonesProveedor;
}

export function totalCajones(v: CajonesProveedor, cual: 'dej' | 'rec'): number {
  return PROVEEDORES.reduce((n, p) => n + (Number((v as any)[p[cual]]) || 0), 0);
}

/** true si el chofer toco algo. Sirve para no pisar la parada cuando abrio la
 *  ventana y la cerro sin cambiar nada. */
export function cambiaronLosCajones(antes: CajonesProveedor, ahora: CajonesProveedor): boolean {
  return Object.keys(CAJONES_VACIO).some((k) => (antes as any)[k] !== (ahora as any)[k]);
}

/** Los seis numeros listos para mandar al servidor: lo que estaba en blanco
 *  se manda como 0, porque en pantalla el chofer vio un 0. */
export function cajonesParaGuardar(v: CajonesProveedor): CajonesProveedor {
  const o: any = {};
  for (const k of Object.keys(CAJONES_VACIO)) o[k] = Number((v as any)[k]) || 0;
  return o as CajonesProveedor;
}

/** Resumen corto para el listado de paradas: "PECO 5/3 · BURZACO 3/1"
 *  (dejó/recuperó). Los proveedores sin cajones no se muestran. */
export function resumenPorProveedor(stop: any): string {
  return PROVEEDORES
    .map((p) => {
      const d = Number(stop?.[p.dej]) || 0;
      const r = Number(stop?.[p.rec]) || 0;
      return d || r ? `${p.nombre} ${d}/${r}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

const clamp = (n: number) => Math.max(0, Math.min(999, Math.round(n)));

function Contador({ label, valor, onChange }: {
  label: string;
  valor: number | null;
  onChange: (n: number) => void;
}) {
  const n = Number(valor) || 0;
  return (
    <View style={styles.fila}>
      <Text style={styles.filaLabel}>{label}</Text>
      <Pressable
        style={[styles.boton, n === 0 && styles.botonOff]}
        onPress={() => onChange(clamp(n - 1))}
        disabled={n === 0}
        hitSlop={8}
        accessibilityLabel={`Restar uno a ${label}`}
      >
        <Text style={styles.botonTxt}>−</Text>
      </Pressable>
      <TextInput
        style={[styles.input, n > 0 && styles.inputOn]}
        value={String(n)}
        onChangeText={(t) => {
          const soloNumeros = t.replace(/[^0-9]/g, '');
          onChange(soloNumeros === '' ? 0 : clamp(Number(soloNumeros)));
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={3}
        accessibilityLabel={`Cantidad de ${label}`}
      />
      <Pressable
        style={styles.boton}
        onPress={() => onChange(clamp(n + 1))}
        hitSlop={8}
        accessibilityLabel={`Sumar uno a ${label}`}
      >
        <Text style={styles.botonTxt}>+</Text>
      </Pressable>
    </View>
  );
}

/** Cajones separados por proveedor del envase.
 *  Una tarjeta por proveedor, con los dos numeros que importan: cuantos dejo y
 *  cuantos recupero. Se puede escribir el numero o corregirlo con − y +, y
 *  abajo siempre esta el total, para que el chofer vea lo que va a guardar. */
export default function CajonesPorProveedor({ valor, onChange, soloRecuperados }: {
  valor: CajonesProveedor;
  onChange: (v: CajonesProveedor) => void;
  /** Entrega no realizada: no dejo nada, solo pudo retirar envases vacios. */
  soloRecuperados?: boolean;
}) {
  const set = (campo: string, n: number) => onChange({ ...valor, [campo]: n } as CajonesProveedor);
  const totalDej = totalCajones(valor, 'dej');
  const totalRec = totalCajones(valor, 'rec');

  return (
    <View>
      {PROVEEDORES.map((p) => {
        const dej = Number((valor as any)[p.dej]) || 0;
        const rec = Number((valor as any)[p.rec]) || 0;
        const activo = dej > 0 || rec > 0;
        return (
          <View key={p.nombre} style={[styles.tarjeta, activo && styles.tarjetaOn]}>
            <View style={styles.cabeza}>
              <Text style={styles.nombre}>{p.nombre}</Text>
              {activo ? (
                <Text style={styles.resumen}>
                  {soloRecuperados ? `recuperé ${rec}` : `dejé ${dej} · recuperé ${rec}`}
                </Text>
              ) : (
                <Text style={styles.resumenOff}>sin cajones</Text>
              )}
            </View>
            {!soloRecuperados && (
              <Contador label="Dejé" valor={dej} onChange={(n) => set(p.dej, n)} />
            )}
            <Contador label="Recuperé" valor={rec} onChange={(n) => set(p.rec, n)} />
          </View>
        );
      })}

      <View style={styles.total}>
        {!soloRecuperados && (
          <View style={styles.totalItem}>
            <Text style={styles.totalLabel}>TOTAL DEJÉ</Text>
            <Text style={styles.totalNum}>{totalDej}</Text>
          </View>
        )}
        <View style={styles.totalItem}>
          <Text style={styles.totalLabel}>TOTAL RECUPERÉ</Text>
          <Text style={styles.totalNum}>{totalRec}</Text>
        </View>
        {!soloRecuperados && (
          <View style={styles.totalItem}>
            <Text style={styles.totalLabel}>QUEDAN AHÍ</Text>
            <Text style={[styles.totalNum, totalDej - totalRec > 0 && styles.totalNumAlerta]}>
              {totalDej - totalRec}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { marginTop: 10, padding: 12, borderRadius: 16, backgroundColor: '#f2f3f6', borderWidth: 2, borderColor: 'transparent' },
  tarjetaOn: { backgroundColor: '#f4f1ff', borderColor: '#cabeff' },
  cabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  nombre: { fontSize: 17, fontWeight: '900', color: '#191c1e', letterSpacing: 0.5 },
  resumen: { fontSize: 12, fontWeight: '800', color: '#451ebb' },
  resumenOff: { fontSize: 12, fontWeight: '700', color: '#9a9da1' },
  fila: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  filaLabel: { flex: 1, fontSize: 15, fontWeight: '800', color: '#44474a' },
  boton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#451ebb', alignItems: 'center', justifyContent: 'center' },
  botonOff: { backgroundColor: '#c7c9cc' },
  botonTxt: { color: '#fff', fontSize: 26, fontWeight: '900', lineHeight: 28 },
  input: { width: 64, height: 46, marginHorizontal: 8, borderRadius: 12, backgroundColor: '#fff', textAlign: 'center', fontSize: 22, fontWeight: '900', color: '#9a9da1' },
  inputOn: { color: '#191c1e' },
  total: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#dfe2e5' },
  totalItem: { flex: 1, alignItems: 'center' },
  totalLabel: { fontSize: 10, fontWeight: '900', color: '#74777b', letterSpacing: 0.5 },
  totalNum: { fontSize: 24, fontWeight: '900', color: '#191c1e', marginTop: 2 },
  totalNumAlerta: { color: '#b3261e' },
});
