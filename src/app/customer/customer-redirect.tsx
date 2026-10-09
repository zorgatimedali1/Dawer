import { Navigate, useParams } from 'react-router-dom';

export default function CustomerRedirect() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();

  return <Navigate to={`/wheels/${encodeURIComponent(campaignId)}`} replace />;
}
