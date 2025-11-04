import React, { useState, useEffect } from 'react';
import { FaDiceD20, FaTimes } from 'react-icons/fa';
import PropTypes from 'prop-types';
import { useAuth } from '../../AuthContext';
import logDiceRoll from './diceLogger';

// Dice roller overlay. Can be rendered inside or outside AuthContext provider.
// If rendered outside, it will gracefully skip user-based logging.
export default function DiceRoller({ faces, count, modifier, description, onComplete, user: forcedUser }) {
  const [currentTotal, setCurrentTotal] = useState(0);
  const [currentRolls, setCurrentRolls] = useState([]);
  const [finished, setFinished] = useState(false);
  // Safely access auth context (it may be undefined if mounted outside provider)
  // Unconditional hook call to satisfy react-hooks rules; if provider missing, authCtx may be undefined.
  const authCtx = useAuth();
  const user = forcedUser || (authCtx && authCtx.user);

  useEffect(() => {
    let iterations = 0;
    const totalIterations = 20;
    const interval = setInterval(() => {
      // simulate rolling each die and calculate sum
      const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1);
      const sum = rolls.reduce((a, b) => a + b, 0) + modifier;
      setCurrentRolls(rolls);
      setCurrentTotal(sum);
      iterations++;
      if (iterations >= totalIterations) {
        clearInterval(interval);
        setFinished(true);
        // wait for user to close overlay before calling onComplete
      }
    }, 100);
    return () => clearInterval(interval);
  }, [faces, count, modifier]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 p-6 rounded-lg shadow-xl w-full max-w-md relative text-white text-center">
        <h3 className="mb-4 text-lg font-semibold">{description}</h3>
        {/* Dice formula used */}
        <p className="mb-3 text-sm text-gray-300 tracking-wide">
          Dice: <span className="font-mono text-indigo-300">{`${count}d${faces}`}{modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ''}</span>
        </p>
        <FaDiceD20 size={48} className="mb-4 mx-auto" />
        {/* Show roll expression */}
        <div className="text-2xl font-bold">
          {currentRolls.join(' + ')}{modifier !== 0 ? ` + ${modifier}` : ''}
        </div>
        {/* Show result after finish */}
        {finished && (
          <div className="mt-2 text-xl">
            Result = {currentTotal}
          </div>
        )}
        {finished && (
          <button
            onClick={async () => {
              const meta = { rolls: currentRolls, modifier, faces, count, description };
              // Fire logging first (non-blocking, but we await to reduce race on immediate unmount)
              if (user?.uid) {
                try {
                  await logDiceRoll(user.uid, { total: currentTotal, meta });
                } catch (e) {
                  // Silently ignore logging errors
                }
              }
              onComplete(currentTotal, meta);
            }}
            aria-label="Close"
            className="absolute top-2 right-3 text-gray-400 hover:text-white text-xl"
          >
            <FaTimes />
          </button>
        )}
      </div>
    </div>
  );
}

DiceRoller.propTypes = {
  faces: PropTypes.number.isRequired,
  count: PropTypes.number,
  modifier: PropTypes.number,
  description: PropTypes.string,
  onComplete: PropTypes.func.isRequired,
  user: PropTypes.object, // optional user override
};

DiceRoller.defaultProps = {
  count: 1,
  modifier: 0,
  description: 'Rolling Dice',
  user: undefined,
};