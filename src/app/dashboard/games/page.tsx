"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type GameSegment = {
  id: number;
  label: string;
  color: string;
  probability: number;
};

export default function GamesPage() {
  const [gameType, setGameType] = useState('prize_wheel');
  const [gameConfig, setGameConfig] = useState<{ title: string; description: string; themeColor: string; segments: GameSegment[] }>({
    title: 'Summer Prize Wheel',
    description: 'Spin to win exciting rewards!',
    themeColor: '#ff6b6b',
    segments: [
      { id: 1, label: '5% OFF', color: '#ff9e80', probability: 0.3 },
      { id: 2, label: '10% OFF', color: '#ffcc80', probability: 0.25 },
      { id: 3, label: 'FREE DRINK', color: '#a5d6a7', probability: 0.2 },
      { id: 4, label: 'FREE DESSERT', color: '#81c784', probability: 0.15 },
      { id: 5, label: 'JACKPOT: 50% OFF', color: '#ff8a80', probability: 0.05 },
      { id: 6, label: 'TRY AGAIN', color: '#e0e0e0', probability: 0.05 },
    ],
  });

  const handleCreateGame = () => {
    console.log('Create game clicked');
  };

  const handleSaveGameConfiguration = () => {
    console.log('Save game configuration clicked');
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Games</h2>
          <p className="text-sm text-gray-600">Create and manage interactive games for your campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleCreateGame}>New Game</Button>
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-medium text-gray-700">Game Type:</span>
          <select
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
            className="block rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          >
            <option value="prize_wheel">Prize Wheel</option>
            <option value="scratch_card">Scratch Card</option>
            <option value="slot_machine">Slot Machine</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Game Configuration</h3>

          <div className="mb-4">
            <label htmlFor="game-title" className="block text-sm font-medium text-gray-700 mb-1">
              Game Title
            </label>
            <input
              id="game-title"
              type="text"
              placeholder="Enter game title..."
              value={gameConfig.title}
              onChange={(e) => setGameConfig({ ...gameConfig, title: e.target.value })}
              className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="game-description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="game-description"
              rows={3}
              placeholder="Enter game description..."
              value={gameConfig.description}
              onChange={(e) => setGameConfig({ ...gameConfig, description: e.target.value })}
              className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="theme-color" className="block text-sm font-medium text-gray-700 mb-1">
              Theme Color
            </label>
            <input
              id="theme-color"
              type="color"
              value={gameConfig.themeColor}
              onChange={(e) => setGameConfig({ ...gameConfig, themeColor: e.target.value })}
              className="w-12 h-12 rounded-md border-0 p-0"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="game-preview" className="block text-sm font-medium text-gray-700 mb-1">
              Live Preview
            </label>
            <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center relative overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  background: `conic-gradient(${gameConfig.segments
                    .map((seg, idx) => {
                      const start = gameConfig.segments.slice(0, idx).reduce((sum, s) => sum + s.probability, 0) * 360;
                      const end = start + seg.probability * 360;
                      return `${seg.color} ${start}deg ${end}deg`;
                    })
                    .reverse()
                    .join(', ')})`,
                  WebkitMaskImage: 'radial-gradient(circle closest-side, white 70%, transparent 71%)',
                  maskImage: 'radial-gradient(circle closest-side, white 70%, transparent 71%)',
                }}
              />
              <div className="relative z-10 flex items-center justify-center h-full w-full">
                <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-lg">
                  <span className="text-2xl font-bold">🎡</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 text-center">Wheel preview - colors represent probability distribution</p>
          </div>

          <div className="mb-6">
            <label htmlFor="segments" className="block text-sm font-medium text-gray-700 mb-1">
              Wheel Segments
            </label>
            <div className="space-y-3">
              {gameConfig.segments.map((segment) => (
                <div key={segment.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-shrink-0 h-8 w-8" style={{ backgroundColor: segment.color }} />
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <input
                        type="text"
                        placeholder="Segment label"
                        value={segment.label}
                        onChange={(e) => {
                          const newSegments: GameSegment[] = [...gameConfig.segments];
                          const index = newSegments.findIndex((s) => s.id === segment.id);
                          const current = newSegments[index];
                          if (!current) return;
                          newSegments[index] = { ...current, label: e.target.value };
                          setGameConfig({ ...gameConfig, segments: newSegments });
                        }}
                        className="block w-full rounded-md border-0 px-2 py-1 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                      />
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500">Probability:</span>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={segment.probability}
                          onChange={(e) => {
                            const value = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
                            const newSegments: GameSegment[] = [...gameConfig.segments];
                            const index = newSegments.findIndex((s) => s.id === segment.id);
                            const current = newSegments[index];
                            if (!current) return;
                            newSegments[index] = { ...current, probability: value };
                            setGameConfig({ ...gameConfig, segments: newSegments });
                          }}
                          className="w-20 rounded-md border-0 px-2 py-1 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                        />
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setGameConfig({ ...gameConfig, segments: gameConfig.segments.filter((s) => s.id !== segment.id) });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newSegment = {
                      id: Date.now(),
                      label: 'New Segment',
                      color: '#80deea',
                      probability: 0.1,
                    };
                    setGameConfig({ ...gameConfig, segments: [...gameConfig.segments, newSegment] });
                  }}
                >
                  Add Segment
                </Button>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200">
              <Button onClick={handleSaveGameConfiguration}>Save Game Configuration</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}