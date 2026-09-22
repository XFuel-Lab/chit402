import { Navigate } from 'react-router-dom';

/** Legacy path — use /doors */
export default function DocsDoors() {
  return <Navigate to="/doors" replace />;
}
