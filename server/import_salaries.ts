import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const salaries = [
    {"Apellido": "AVILA", "Nombre": "EMANUEL GUSTAVO", "Tipo Puesto": "Chofer", "Bruto": 1414494.32, "Jornal": 0},
    {"Apellido": "BASTIDA", "Nombre": "MARCELO ANGEL", "Tipo Puesto": "Chofer", "Bruto": 1362468.11, "Jornal": 0},
    {"Apellido": "BUNGS", "Nombre": "JAVIER", "Tipo Puesto": "Chofer", "Bruto": 1260427.68, "Jornal": 0},
    {"Apellido": "D'AMICO", "Nombre": "GERMAN", "Tipo Puesto": "Chofer", "Bruto": 1302535.92, "Jornal": 0},
    {"Apellido": "GALARZA", "Nombre": "DAMIAN", "Tipo Puesto": "Chofer", "Bruto": 1250703.16, "Jornal": 0},
    {"Apellido": "SILVA", "Nombre": "EZEQUIEL", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "SUAREZ", "Nombre": "MAXIMILIANO", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "VERBES", "Nombre": "RUBEN ESTEBAN", "Tipo Puesto": "Chofer", "Bruto": 1289601.26, "Jornal": 0},
    {"Apellido": "ALVIÑA", "Nombre": "NAHUEL", "Tipo Puesto": "Auxiliar", "Bruto": 1031351.3, "Jornal": 46879.6},
    {"Apellido": "ARISMENDI", "Nombre": "GERMAN EZEQUIEL", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "BERNACHEA", "Nombre": "CARLOS ALBERTO", "Tipo Puesto": "Auxiliar", "Bruto": 1150460.06, "Jornal": 52293.64},
    {"Apellido": "BRITOS", "Nombre": "EZEQUIEL ALEXIS", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "BRITOS", "Nombre": "FEDERICO NAHUEL", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "CARVAJAL", "Nombre": "JONATHAN", "Tipo Puesto": "Auxiliar", "Bruto": 1054963.69, "Jornal": 47952.89},
    {"Apellido": "CUEVA", "Nombre": "ARIEL HERNAN", "Tipo Puesto": "Auxiliar", "Bruto": 1070705.28, "Jornal": 48668.42},
    {"Apellido": "D'AMICO", "Nombre": "AXEL", "Tipo Puesto": "Auxiliar", "Bruto": 1073573.53, "Jornal": 48798.8},
    {"Apellido": "DONATI", "Nombre": "SANTIAGO", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "FERNANDEZ", "Nombre": "BENJAMIN", "Tipo Puesto": "Auxiliar", "Bruto": 1031351.3, "Jornal": 46879.6},
    {"Apellido": "GOMEZ", "Nombre": "LAUTARO LEONEL", "Tipo Puesto": "Auxiliar", "Bruto": 1047092.89, "Jornal": 47595.13},
    {"Apellido": "LENCINA", "Nombre": "ARIEL", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "MARINGOLO", "Nombre": "MILTON", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "MARTINEZ", "Nombre": "LAUTARO", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "MONTIEL", "Nombre": "JOAQUIN", "Tipo Puesto": "Auxiliar", "Bruto": 1039222.1, "Jornal": 47237.37},
    {"Apellido": "RIVAROLA", "Nombre": "MARIO ANDRES", "Tipo Puesto": "Auxiliar", "Bruto": 1185091.56, "Jornal": 53867.8},
    {"Apellido": "RODRIGUEZ", "Nombre": "TOBIAS JESUS", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "RODRIGUEZ", "Nombre": "DENIS", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "ROMERO", "Nombre": "WALTER", "Tipo Puesto": "Auxiliar", "Bruto": 1047092.89, "Jornal": 47595.13},
    {"Apellido": "SALAZAR", "Nombre": "EZEQUIEL", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "TABOADA", "Nombre": "MAURICIO", "Tipo Puesto": "Auxiliar", "Bruto": 835767.53, "Jornal": 37989.43},
    {"Apellido": "ZURITA", "Nombre": "ELIAS", "Tipo Puesto": "Auxiliar", "Bruto": 1054963.69, "Jornal": 47952.89}
];

async function main() {
    const months = ['enero', 'febrero'];
    console.log("Importing salaries for Jan and Feb...");
    for (const month of months) {
        for (const s of salaries) {
            await prisma.employeeSalary.upsert({
                where: { month_lastName: { month: month, lastName: s.Apellido } },
                update: {
                    firstName: s.Nombre,
                    role: s["Tipo Puesto"],
                    grossSalary: s.Bruto,
                    dailyWage: s.Jornal || 0
                },
                create: {
                    month: month,
                    firstName: s.Nombre,
                    lastName: s.Apellido,
                    role: s["Tipo Puesto"],
                    grossSalary: s.Bruto,
                    dailyWage: s.Jornal || 0
                }
            });
        }
    }
    console.log("Salaries import finished.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
