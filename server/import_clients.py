
import pandas as pd
import sqlite3
import os

def import_clients():
    file_path = r'C:\Users\juanma\Desktop\PERSAT INFORMACION\clientes_exportado_completo.xlsx'
    db_path = r'C:\Users\juanma\Desktop\Ai\real-de-catorce-app\server\prisma\r14.db'
    
    if not os.path.exists(db_path):
        print(f"Error: No se encontró la base de datos en {db_path}")
        return

    df = pd.read_excel(file_path)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("Limpiando tabla de clientes...")
    cursor.execute("DELETE FROM Client")
    
    tenant_id = 'default-tenant'
    
    print(f"Importando {len(df)} clientes con barrios...")
    
    imported = 0
    for _, row in df.iterrows():
        try:
            import uuid
            c_id = str(uuid.uuid4())
            name = str(row.get('Cliente', 'Sin Nombre'))
            address = str(row.get('Dirección (calle)', ''))
            lat = float(row.get('Latitud')) if pd.notnull(row.get('Latitud')) else None
            lng = float(row.get('Longitud')) if pd.notnull(row.get('Longitud')) else None
            
            start = str(row.get('Inicio de Jornada [HH:mm]', '08:00')) if pd.notnull(row.get('Inicio de Jornada [HH:mm]')) else '08:00'
            end = str(row.get('Fin de Jornada [HH:mm]', '12:00')) if pd.notnull(row.get('Fin de Jornada [HH:mm]')) else '12:00'
            
            service = int(row.get('Tiempo de Servicio [min]', 15)) if pd.notnull(row.get('Tiempo de Servicio [min]')) else 15
            zone = str(row.get('Zonas (separadas por ;)', 'GBA'))
            barrio = str(row.get('Barrio', '')) if pd.notnull(row.get('Barrio')) else ''

            cursor.execute("""
                INSERT INTO Client (id, name, address, latitude, longitude, timeWindowStart, timeWindowEnd, serviceTime, zone, barrio, tenantId, priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (c_id, name, address, lat, lng, start, end, service, zone, barrio, tenant_id, 0))
            imported += 1
        except Exception as e:
            print(f"Error en fila {name}: {e}")

    conn.commit()
    conn.close()
    print(f"Proceso finalizado. Se importaron {imported} clientes exitosamente.")

if __name__ == "__main__":
    import_clients()
