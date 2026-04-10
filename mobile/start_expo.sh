#!/bin/bash
cd "C:\Users\Usuario\Desktop\Claude\Sistema-logistico-real-de-catorce\mobile"

# Mostrar información
echo "=== Starting Expo Start ==="
echo "Timestamp: $(date)"
echo "Working directory: $(pwd)"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "=== Environment ==="
echo "EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"
echo "=== Running Expo ==="

# Ejecutar expo start
npx expo start --port 8089 2>&1

echo "=== Expo Finished ==="
