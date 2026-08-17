'use client';

import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
  description?: string;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch products');
        return res.json();
      })
      .then((data) => {
        setProducts(data.products || data || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <main style={{ maxWidth: '800px', margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>
      <header style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>Vanity Store</h1>
        <p style={{ color: '#666' }}>Connected to your backend APIs</p>
      </header>

      {loading && <p style={{ textAlign: 'center' }}>Loading products from API...</p>}
      {error && <p style={{ textAlign: 'center', color: 'red' }}>Error: {error}</p>}

      {!loading && !error && products.length === 0 && (
        <p style={{ textAlign: 'center', color: '#888' }}>No products found in the database yet.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
        {products.map((product) => (
          <div key={product.id} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '20px', background: '#fff' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>{product.name}</h3>
            <p style={{ color: '#442', fontWeight: 'bold', fontSize: '1.2rem' }}>${product.price}</p>
            {product.description && <p style={{ color: '#666', fontSize: '0.9rem' }}>{product.description}</p>}
          </div>
        ))}
      </div>
    </main>
  );
}