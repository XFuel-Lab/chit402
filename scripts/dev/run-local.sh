#!/bin/bash

echo "🚀 Starting XFUEL Local Development..."
echo ""
echo "Starting Backend API Server (Port 3001)..."
npm run dev:backend &
BACKEND_PID=$!

sleep 3

echo ""
echo "Starting Frontend Dev Server..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ Both servers starting..."
echo "Backend: http://localhost:3001"
echo "Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user interrupt
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait

